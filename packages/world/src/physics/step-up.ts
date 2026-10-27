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
 * On success the returned delta (forward + net vertical) is applied
 * through the caller's normal movement pipeline; the caller must zero
 * its integrated fall velocity (the character is grounded on the
 * ledge).
 *
 * The probe POSE is always restored before returning, success or not —
 * callers re-apply the delta themselves so broadcast/store/animation
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

/**
 * Attempt a step-up in the direction of (dx, dz). Returns the movement
 * delta to apply (relative to the character's current position), or
 * `null` when no climbable ledge is there. Pose is always restored.
 */
export function tryStepUp(
  probe: StepUpProbe,
  dx: number,
  dz: number,
  maxHeight: number = STEP_UP_MAX_HEIGHT,
): Vec3 | null {
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

  // The applied delta is the exact sum of the three probe movements.
  return {
    x: up.x + fwd.x + down.x,
    y: landedRise,
    z: up.z + fwd.z + down.z,
  };
}
