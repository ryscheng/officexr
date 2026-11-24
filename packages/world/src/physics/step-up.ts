/**
 * Step-up assist — deterministic ledge climbing for kinematic
 * characters, shared by the local player (SceneFrame) and bots
 * (BotPhysicsWorld).
 *
 * WHY THIS EXISTS
 * ---------------
 * Rapier's built-in `enableAutostep` does not lift a BALL collider
 * over ledges taller than its contact geometry allows (verified by
 * deterministic simulation: a 0.4 m ball never autosteps a 0.5 m
 * riser under ANY autostep config, at any frame rate — characters
 * could historically "climb" only via 0.25 m sub-radius corner
 * sliding, which is why the old stair colliders deliberately faked
 * 16×0.25 steps). With colliders now scanned honestly from the real
 * meshes (0.5 m risers), climbing needs an explicit mechanism.
 *
 * ALGORITHM (runs only on frames where horizontal movement is blocked
 * while grounded and not jumping):
 *   1. UP probe: sweep the character up by `maxHeight`. Anything less
 *      than the full lift means a ceiling — abort. (This is what keeps
 *      crawl spaces honest.)
 *   2. FORWARD probe (from the lifted pose): sweep along the intended
 *      direction by at least `forwardClearance` — enough that the
 *      character's contact foot actually passes the ledge edge.
 *      Substantially blocked forward means a tall wall, not a step —
 *      abort. (This is what keeps 2 m walls unclimbable.)
 *   3. DOWN probe: sweep back down. The character must land GROUNDED
 *      and strictly higher than it started — otherwise there was no
 *      ledge (we'd just hop in place) — abort.
 * On success the returned path (net rise + horizontal carry) is walked
 * by the caller — paced by `StepUpTraversal` / `stepTraversal`, or as a
 * one-frame delta — through its normal movement pipeline; the caller
 * must zero its integrated fall velocity (the character is grounded on
 * the ledge).
 *
 * The probe POSE is always restored before returning, success or not —
 * callers apply the movement themselves so broadcast/store/animation
 * pipelines see one consistent movement.
 *
 * DIP: this module knows nothing about Rapier, React, or which world
 * it runs in. Callers adapt their controller/body pair to
 * `StepUpProbe` (the body mutation must propagate to colliders —
 * `world.propagateModifiedBodyPositionsToColliders()` in Rapier).
 */

import type { Vec3 } from '@officexr/sdk';

/** Horizontal distance the assist carries the character past the
 * ledge edge — at least the ball radius (0.4) plus a margin so the
 * contact foot lands ON the tread instead of teetering on its corner.
 * The one-frame forward carry is the "hop" feel of taking a step. */
export const STEP_UP_FORWARD_CLEARANCE = 0.45;

/** Tallest ledge the assist will climb. The REAL KayKit staircase
 * risers are 0.5 m (measured by the geometry scanner — the old
 * 16×0.25 hand spec was a deliberate fake), so the limit sits above
 * 0.5 with margin while full 2 m blocks stay unclimbable. */
export const STEP_UP_MAX_HEIGHT = 0.6;

/** Minimum net rise for a step-up to count as landing on a ledge —
 * below this we were hopping in place and the move is rejected. */
const MIN_LANDED_RISE = 0.05;

/** Fraction of the forward probe that must survive collision
 * resolution for the path to count as clear. */
const MIN_FORWARD_FRACTION = 0.5;

/** One collide-and-slide query against the character controller. */
export interface StepUpComputeResult {
  x: number;
  y: number;
  z: number;
  grounded: boolean;
}

export interface StepUpProbe {
  /** computeColliderMovement + computedMovement/computedGrounded. */
  compute(desired: Vec3): StepUpComputeResult;
  /** Current body translation. */
  getTranslation(): Vec3;
  /** Teleport the body for probing. MUST propagate the new pose to
   * the colliders so subsequent compute() calls see it. */
  setTranslation(p: Vec3): void;
  /** True when the most recent compute() touched another CHARACTER
   * (peer body / mirror), as opposed to world geometry. Characters
   * are never stairs: any probe contact with one rejects the step-up
   * — otherwise a character blocked head-on "climbs" onto the other's
   * ball top (their head). Same-frame collision lists are NOT enough
   * for this guard: a contact-clamped peer mirror can block a sweep
   * without appearing in the list, so each probe must be checked. */
  lastContactIsCharacter(): boolean;
}

/** A validated step, relative to the character's current position:
 * rise straight up by `rise`, then carry horizontally by `forward`.
 * Walking rise-then-forward (instead of the probes' up/forward/down)
 * keeps Y from ever dipping mid-step. */
export interface StepUpPath {
  rise: number;
  forward: { x: number; z: number };
}

/**
 * Attempt a step-up in the direction of (dx, dz). Returns the path to
 * the ledge, or `null` when no climbable ledge is there. Pose is always
 * restored.
 */
export function tryStepUp(
  probe: StepUpProbe,
  dx: number,
  dz: number,
  maxHeight: number = STEP_UP_MAX_HEIGHT,
): StepUpPath | null {
  const len = Math.hypot(dx, dz);
  if (len < 1e-9) return null;
  const start = { ...probe.getTranslation() };

  // 1. UP: full headroom or bust.
  const up = probe.compute({ x: 0, y: maxHeight, z: 0 });
  if (up.y < maxHeight - 0.01) return null;
  probe.setTranslation({
    x: start.x + up.x,
    y: start.y + up.y,
    z: start.z + up.z,
  });

  // 2. FORWARD: carry the contact foot past the ledge edge.
  const dist = Math.max(len, STEP_UP_FORWARD_CLEARANCE);
  const fwd = probe.compute({
    x: (dx / len) * dist,
    y: 0,
    z: (dz / len) * dist,
  });
  if (
    Math.hypot(fwd.x, fwd.z) < dist * MIN_FORWARD_FRACTION ||
    probe.lastContactIsCharacter()
  ) {
    probe.setTranslation(start);
    return null;
  }
  const lifted = probe.getTranslation();
  probe.setTranslation({
    x: lifted.x + fwd.x,
    y: lifted.y + fwd.y,
    z: lifted.z + fwd.z,
  });

  // 3. DOWN: must land grounded, strictly above the starting floor —
  // and on world geometry, never on another character's head.
  const down = probe.compute({ x: 0, y: -(maxHeight + 0.05), z: 0 });
  const landedOnCharacter = probe.lastContactIsCharacter();
  probe.setTranslation(start);
  const landedRise = up.y + fwd.y + down.y;
  if (!down.grounded || landedOnCharacter || landedRise < MIN_LANDED_RISE) {
    return null;
  }

  // The path's endpoint is the exact sum of the three probe movements.
  return {
    rise: landedRise,
    forward: { x: up.x + fwd.x + down.x, z: up.z + fwd.z + down.z },
  };
}

/** A walking climb takes one riser (`step`); a running one takes two
 * at once (`leap`), played with the jump animation. */
export type StepUpKind = 'step' | 'leap';

export interface StepUpClimb {
  kind: StepUpKind;
  path: StepUpPath;
}

/**
 * The step-up for the character's gait. Walking, it is `tryStepUp`.
 * Running, a second `tryStepUp` is probed from the first step's landing
 * in the same direction, and when both succeed the climb is one leap
 * over both risers. When the second riser isn't there (top of the
 * stairs, a wall, a low ceiling, another character) it falls back to
 * the single step. Pose is always restored.
 */
export function tryGaitStepUp(
  probe: StepUpProbe,
  dx: number,
  dz: number,
  running: boolean,
  maxHeight: number = STEP_UP_MAX_HEIGHT,
): StepUpClimb | null {
  const first = tryStepUp(probe, dx, dz, maxHeight);
  if (!first) {
    return null;
  }
  const leap = running ? chainSecondStep(probe, first, dx, dz, maxHeight) : null;
  return leap ? { kind: 'leap', path: leap } : { kind: 'step', path: first };
}

/** `first` extended by the step-up found from its landing, or null. */
function chainSecondStep(
  probe: StepUpProbe,
  first: StepUpPath,
  dx: number,
  dz: number,
  maxHeight: number,
): StepUpPath | null {
  const start = { ...probe.getTranslation() };
  probe.setTranslation({
    x: start.x + first.forward.x,
    y: start.y + first.rise,
    z: start.z + first.forward.z,
  });
  const second = tryStepUp(probe, dx, dz, maxHeight);
  const combined = second && {
    rise: first.rise + second.rise,
    forward: {
      x: first.forward.x + second.forward.x,
      z: first.forward.z + second.forward.z,
    },
  };
  const clear = combined !== null && pathIsClear(probe, start, combined);
  probe.setTranslation(start);
  return clear ? combined : null;
}

/** Sweeps `path` from `start` the way the traversal walks it. Each leg
 * was probed from its own floor, so the combined rise still needs its
 * headroom checked from the bottom step, and the carry at full height. */
function pathIsClear(probe: StepUpProbe, start: Vec3, path: StepUpPath): boolean {
  probe.setTranslation(start);
  const up = probe.compute({ x: 0, y: path.rise, z: 0 });
  if (up.y < path.rise - 0.01 || probe.lastContactIsCharacter()) {
    return false;
  }
  probe.setTranslation({ x: start.x + up.x, y: start.y + up.y, z: start.z + up.z });
  const fwd = probe.compute({ x: path.forward.x, y: 0, z: path.forward.z });
  const forwardLen = Math.hypot(path.forward.x, path.forward.z);
  return (
    Math.hypot(fwd.x, fwd.z) >= forwardLen * MIN_FORWARD_FRACTION &&
    !probe.lastContactIsCharacter()
  );
}

/** Walks a `StepUpPath` at a constant `speed` (m/s along the path). */
export class StepUpTraversal {
  /** Unit XZ direction of the forward carry. */
  readonly forwardDir: { x: number; z: number };
  private readonly forwardLen: number;
  private travelled = 0;

  constructor(
    private readonly path: StepUpPath,
    readonly speed: number,
    readonly kind: StepUpKind = 'step',
  ) {
    this.forwardLen = Math.hypot(path.forward.x, path.forward.z);
    this.forwardDir =
      this.forwardLen > 0
        ? { x: path.forward.x / this.forwardLen, z: path.forward.z / this.forwardLen }
        : { x: 0, z: 0 };
  }

  /** Horizontal climb velocity: `forwardDir × speed`. */
  get velocity(): { x: number; z: number } {
    return { x: this.forwardDir.x * this.speed, z: this.forwardDir.z * this.speed };
  }

  /** Moves `speed·dtSec` further along the path (clamped to its end) and
   * returns that slice; `done` is true on the call that reaches the end. */
  advance(dtSec: number): { delta: Vec3; done: boolean } {
    const length = this.path.rise + this.forwardLen;
    const from = this.pointAt(this.travelled);
    this.travelled = Math.min(this.travelled + this.speed * dtSec, length);
    const to = this.pointAt(this.travelled);
    return {
      delta: { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z },
      done: this.travelled >= length,
    };
  }

  private pointAt(s: number): Vec3 {
    const carried = Math.max(0, s - this.path.rise);
    return {
      x: this.forwardDir.x * carried,
      y: Math.min(s, this.path.rise),
      z: this.forwardDir.z * carried,
    };
  }
}

/** Below this fraction of a slice surviving the caller's sweep, the
 * climb is treated as obstructed and abandoned. */
const MIN_SLICE_FRACTION = 0.5;

/**
 * One frame of a climb: advances `traversal`, sweeps the slice through
 * the caller's controller, and returns the swept delta to apply.
 * `ended` is true when the path is finished or the sweep cut the slice
 * short; the caller then drops the traversal and resumes normal
 * movement and gravity.
 */
export function stepTraversal(
  traversal: StepUpTraversal,
  dtSec: number,
  sweep: (desired: Vec3) => Vec3,
): { delta: Vec3; ended: boolean } {
  const { delta: requested, done } = traversal.advance(dtSec);
  const delta = sweep(requested);
  const requestedSq = requested.x ** 2 + requested.y ** 2 + requested.z ** 2;
  const survived =
    requestedSq > 0
      ? (delta.x * requested.x + delta.y * requested.y + delta.z * requested.z) / requestedSq
      : 1;
  return { delta, ended: done || survived < MIN_SLICE_FRACTION };
}

/**
 * What a climbing character broadcasts: the climb velocity scaled by
 * `climbAnimFactor` (it drives the walk animation's rate), facing along
 * the climb, or `currentYaw` when the climb has no horizontal carry.
 */
export function climbBroadcast(
  climbVel: { x: number; z: number },
  climbAnimFactor: number,
  currentYaw: number,
): { vel: Vec3; yaw: number } {
  const { x, z } = climbVel;
  return {
    vel: { x: x * climbAnimFactor, y: 0, z: z * climbAnimFactor },
    yaw: x !== 0 || z !== 0 ? Math.atan2(-x, -z) : currentYaw,
  };
}
