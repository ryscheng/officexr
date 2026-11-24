/**
 * Step-up assist tests — run against the REAL Rapier engine
 * (rapier3d-compat works headlessly under Node), not mocks. These are
 * the bounded-invariant tests for "characters can climb honest stair
 * colliders, and ONLY stair-scale ledges":
 *
 *   - A ball character walking into a scanned-honest staircase
 *     (8 × 0.5 m risers — NOT climbable by Rapier autostep, verified)
 *     reaches the top under the assist at a steady 60 fps.
 *   - Without the assist the same character stays wedged at the first
 *     riser (the regression the assist exists for).
 *   - A 2 m wall is NOT climbed (forward probe fails).
 *   - A low ceiling over the stairs blocks the climb (up probe fails).
 *
 * The CLAUDE.md "no mock-only tests for cross-process behaviour" rule
 * applies in spirit: collide-and-slide behaviour mocked would prove
 * nothing; the real engine is cheap to run here.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  STEP_UP_MAX_HEIGHT,
  StepUpTraversal,
  climbBroadcast,
  stepTraversal,
  tryGaitStepUp,
  tryStepUp,
  type StepUpProbe,
} from './step-up.ts';
import { CHARACTER_CONTROLLER_SKIN } from './rules.ts';
import { faceAhead, stepUpTrigger } from './step-up-trigger.ts';

beforeAll(async () => {
  await RAPIER.init();
});

interface Rig {
  world: RAPIER.World;
  body: RAPIER.RigidBody;
  controller: RAPIER.KinematicCharacterController;
  probe: StepUpProbe;
  compute: (d: { x: number; y: number; z: number }) => {
    x: number;
    y: number;
    z: number;
    grounded: boolean;
  };
  setPos: (p: { x: number; y: number; z: number }) => void;
}

/** Build the scenario-stairs collider field (honest scanned geometry:
 * platform top y=2, 8 step columns 0.5 rise/run ascending toward −X,
 * landing top y=6) plus the character rig with the production
 * controller config. */
function makeStairsRig(opts?: {
  wall?: boolean;
  ceiling?: boolean;
  /** A ceiling over the first two treads, high enough for one step
   * from the platform but not for a step from the first tread. */
  ceilingOverTreads?: boolean;
  /** An overhang above the second tread that cuts a leap's combined
   * carry short but clears the single step. */
  overhangOverSecondTread?: boolean;
  /** A 0.45 m block on the platform beside the wall, further along +Z. */
  blockBesideWall?: boolean;
  startX?: number;
  /** Half-width (z) of the platform, steps, landing and wall: 2 is the
   * scenario's 4 m, wider leaves room to cross them diagonally. */
  halfWidth?: number;
}): Rig {
  const hw = opts?.halfWidth ?? 2;
  const world = new RAPIER.World({ x: 0, y: -50, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(2, 1, hw).setTranslation(6, 1, 2));
  world.createCollider(RAPIER.ColliderDesc.cuboid(2, 3, hw).setTranslation(-2, 3, 2));
  for (let k = 0; k < 8; k++) {
    const x0 = 4 - (k + 1) * 0.5;
    const x1 = 4 - k * 0.5;
    const top = 2 + (k + 1) * 0.5;
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.25, top / 2, hw).setTranslation((x0 + x1) / 2, top / 2, 2),
    );
  }
  if (opts?.wall) {
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.1, 2, hw).setTranslation(4.5, 4, 2));
  }
  if (opts?.ceiling) {
    world.createCollider(RAPIER.ColliderDesc.cuboid(2, 0.1, 2).setTranslation(3, 3.0, 2));
  }
  if (opts?.overhangOverSecondTread) {
    // x 2.5..3.46, y 3.5..3.7: the leap's carry (ball y 3.0..3.8)
    // meets its edge ≈60% of the way; the first step passes beneath.
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.48, 0.1, hw).setTranslation(2.98, 3.6, 2));
  }
  if (opts?.blockBesideWall) {
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.4, 0.225, 0.4).setTranslation(5.0, 2.225, 3.35));
  }
  if (opts?.ceilingOverTreads) {
    // Underside at y=3.6, spanning x 3.0..4.6.
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.8, 0.1, 2).setTranslation(3.8, 3.7, 2));
  }

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(opts?.startX ?? 5, 1.5, 2),
  );
  const ball = world.createCollider(
    RAPIER.ColliderDesc.ball(0.4).setTranslation(0, 0.9, 0),
    body,
  );
  const controller = world.createCharacterController(CHARACTER_CONTROLLER_SKIN);
  controller.setApplyImpulsesToDynamicBodies(false);
  controller.setSlideEnabled(true);
  controller.setUp({ x: 0, y: 1, z: 0 });
  controller.enableSnapToGround(0.3);
  // No engine autostep — matches production (BotPhysicsWorld /
  // SceneFrame); the assist is the only climbing mechanism.

  const compute = (d: { x: number; y: number; z: number }) => {
    controller.computeColliderMovement(ball, d, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
    const c = controller.computedMovement();
    return { x: c.x, y: c.y, z: c.z, grounded: controller.computedGrounded() };
  };
  const setPos = (p: { x: number; y: number; z: number }) => {
    body.setTranslation(p, true);
    world.propagateModifiedBodyPositionsToColliders();
  };
  const probe: StepUpProbe = {
    compute,
    getTranslation: () => {
      const t = body.translation();
      return { x: t.x, y: t.y, z: t.z };
    },
    setTranslation: setPos,
    // The rig has no peer characters; world geometry only.
    lastContactIsCharacter: () => false,
  };
  return { world, body, controller, probe, compute, setPos };
}

/** Walk −X at 3 m/s for `frames` steady-60fps frames, mirroring the
 * production movement loop (gravity integration, blocked detection,
 * the assist on blocked grounded frames). Returns max body y. */
function walkMinusX(rig: Rig, frames: number, useAssist: boolean): number {
  let velY = 0;
  const dt = 1 / 60;
  let maxY = -Infinity;
  for (let i = 0; i < frames; i++) {
    velY += -50 * dt;
    const desired = { x: -3 * dt, y: velY * dt, z: 0 };
    let c = rig.compute(desired);
    const grounded = c.grounded;
    const intentLenSq = desired.x * desired.x + desired.z * desired.z;
    const progress = Math.max(
      0,
      Math.min(1, (c.x * desired.x + c.z * desired.z) / intentLenSq),
    );
    if (useAssist && progress < 0.1 && grounded && velY <= 0) {
      const hop = tryStepUp(rig.probe, desired.x, desired.z);
      if (hop) {
        c = { x: hop.forward.x, y: hop.rise, z: hop.forward.z, grounded: true };
        velY = 0;
      }
    }
    if (grounded || c.y >= 0) velY = 0;
    const t = rig.body.translation();
    rig.setPos({ x: t.x + c.x, y: t.y + c.y, z: t.z + c.z });
    rig.world.step();
    const y = rig.body.translation().y;
    maxY = Math.max(maxY, y);
    // Stop at the landing — walking further would exit the map.
    if (rig.body.translation().x < -0.5) break;
  }
  return maxY;
}

describe('tryStepUp on honest scanned stair colliders (real Rapier)', () => {
  it('climbs all 8 × 0.5 m risers to the top at steady 60 fps', () => {
    const rig = makeStairsRig();
    const maxY = walkMinusX(rig, 1500, true);
    // Top landing: body y = 6.0 − 0.5 = 5.5.
    expect(maxY).toBeGreaterThan(5.4);
  });

  it('control: without the assist the character wedges at the first riser', () => {
    const rig = makeStairsRig();
    const maxY = walkMinusX(rig, 600, false);
    expect(maxY).toBeLessThan(2.0);
  });

  it('does NOT climb a 2 m wall (forward probe rejects)', () => {
    const rig = makeStairsRig({ wall: true, startX: 5.5 });
    const maxY = walkMinusX(rig, 600, true);
    // Wall top at y=6; body would read 5.5+ if climbed. It must stay
    // at platform level (≈1.5, plus epsilon for probe jitter).
    expect(maxY).toBeLessThan(2.0);
  });

  it('does NOT climb under a low ceiling (up probe rejects)', () => {
    const rig = makeStairsRig({ ceiling: true });
    const maxY = walkMinusX(rig, 600, true);
    expect(maxY).toBeLessThan(2.0);
  });

  it('returns null when there is no horizontal intent', () => {
    const rig = makeStairsRig();
    expect(tryStepUp(rig.probe, 0, 0)).toBeNull();
  });

  it('restores the body pose on rejection', () => {
    const rig = makeStairsRig({ wall: true, startX: 5.5 });
    // Walk to the wall first.
    walkMinusX(rig, 120, false);
    const before = { ...rig.body.translation() };
    const hop = tryStepUp(rig.probe, -0.05, 0);
    const after = rig.body.translation();
    expect(hop).toBeNull();
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    expect(after.z).toBeCloseTo(before.z, 9);
  });

  it('max step height clears real risers (0.5) but not blocks (2.0)', () => {
    expect(STEP_UP_MAX_HEIGHT).toBeGreaterThan(0.5);
    expect(STEP_UP_MAX_HEIGHT).toBeLessThan(2.0);
  });

  it('refuses to climb another character (lands-on-character guard)', () => {
    // A peer ball blocking the path IS physically a climbable "ledge"
    // (its top sits within STEP_UP_MAX_HEIGHT of the probe's lifted
    // sweep) — only the character classifier stops the head-climb.
    const rig = makeStairsRig({ startX: 5.5 });
    const peerBody = rig.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(4.7, 1.5, 2),
    );
    const peerBall = rig.world.createCollider(
      RAPIER.ColliderDesc.ball(0.4).setTranslation(0, 0.9, 0),
      peerBody,
    );
    const peerHandles = new Set([peerBall.handle]);
    const classify = () => {
      const n = rig.controller.numComputedCollisions();
      for (let i = 0; i < n; i++) {
        const coll = rig.controller.computedCollision(i);
        if (coll?.collider && peerHandles.has(coll.collider.handle)) return true;
      }
      return false;
    };

    // With the classifier wired, a step-up toward the peer is
    // rejected and the pose is restored. (The full failure mode —
    // overlapped contact-clamped mirrors reading as a climbable
    // ledge — is covered by the scenario-collision e2e; synthetic
    // mirror clamping is BotPhysicsWorld-internal.)
    const guardedProbe: StepUpProbe = { ...rig.probe, lastContactIsCharacter: classify };
    const before = { ...rig.body.translation() };
    expect(tryStepUp(guardedProbe, -0.05, 0)).toBeNull();
    const after = rig.body.translation();
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });
});

/** Walk −X until the first riser blocks the character, then return. */
function walkToFirstRiser(rig: Rig): void {
  walkMinusX(rig, 60, false);
}

describe('tryGaitStepUp: running leaps two risers (real Rapier)', () => {
  const dx = -3 / 60;

  it('a running step-up mid-staircase leaps two risers, ≈1.0 m of rise', () => {
    const rig = makeStairsRig();
    walkToFirstRiser(rig);
    const climb = tryGaitStepUp(rig.probe, dx, 0, { running: true });
    expect(climb?.kind).toBe('leap');
    expect(climb!.path.rise).toBeCloseTo(1.0, 1);
    // Lands on the second tread (x 3.0..3.5), not balanced on its nose.
    expect(rig.body.translation().x + climb!.path.forward.x).toBeLessThan(3.45);
  });

  it('a walking step-up takes a single riser', () => {
    const rig = makeStairsRig();
    walkToFirstRiser(rig);
    const climb = tryGaitStepUp(rig.probe, dx, 0, { running: false });
    expect(climb?.kind).toBe('step');
    expect(climb!.path.rise).toBeCloseTo(0.5, 1);
  });

  it('falls back to a single step on the last riser', () => {
    // Stand on the 7th tread (top y=5.5) against the last riser.
    const rig = makeStairsRig({ startX: 0.9 });
    rig.setPos({ x: 0.9, y: 5.0, z: 2 });
    rig.world.step();
    walkToFirstRiser(rig);
    const climb = tryGaitStepUp(rig.probe, dx, 0, { running: true });
    expect(climb?.kind).toBe('step');
    expect(climb!.path.rise).toBeCloseTo(0.5, 1);
  });

  it('refuses the second leg under a low ceiling, stepping once instead', () => {
    const rig = makeStairsRig({ ceilingOverTreads: true });
    walkToFirstRiser(rig);
    const climb = tryGaitStepUp(rig.probe, dx, 0, { running: true });
    expect(climb?.kind).toBe('step');
    expect(climb!.path.rise).toBeCloseTo(0.5, 1);
  });

  it('steps once when an overhang would cut the leap’s combined carry short', () => {
    const rig = makeStairsRig({ overhangOverSecondTread: true });
    walkToFirstRiser(rig);
    const climb = tryGaitStepUp(rig.probe, dx, 0, { running: true });
    expect(climb?.kind).toBe('step');
    expect(climb!.path.rise).toBeCloseTo(0.5, 1);
  });

  it('steps once when the leap’s combined carry is only 60% clear (scripted probe)', () => {
    // In real stairs the second leg's own probes ride higher than the
    // combined carry, so geometry that cuts only the carry is hard to
    // build; a scripted probe pins the threshold. Calls, in order: leg 1
    // and leg 2 (up, forward, down each), then the carry check (up,
    // forward), which keeps 60% of the 0.9 m carry.
    const results = [
      { x: 0, y: 0.6, z: 0, grounded: false },
      { x: -0.45, y: 0, z: 0, grounded: false },
      { x: 0, y: -0.1, z: 0, grounded: true },
      { x: 0, y: 0.6, z: 0, grounded: false },
      { x: -0.45, y: 0, z: 0, grounded: false },
      { x: 0, y: -0.1, z: 0, grounded: true },
      { x: 0, y: 1.0, z: 0, grounded: false },
      { x: -0.54, y: 0, z: 0, grounded: false },
    ];
    let pos = { x: 0, y: 0, z: 0 };
    const scripted: StepUpProbe = {
      compute: () => results.shift()!,
      getTranslation: () => pos,
      setTranslation: (p) => {
        pos = { ...p };
      },
      lastContactIsCharacter: () => false,
    };
    const climb = tryGaitStepUp(scripted, -0.05, 0, { running: true });
    expect(climb?.kind).toBe('step');
    expect(climb!.path.rise).toBeCloseTo(0.5, 9);
    expect(results).toHaveLength(0);
    expect(pos).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('steps once when another character stands where the leap would land', () => {
    const rig = makeStairsRig();
    walkToFirstRiser(rig);
    // A peer standing on the second tread, where the leap would land.
    const peerBody = rig.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(3.05, 2.5, 2),
    );
    const peerBall = rig.world.createCollider(
      RAPIER.ColliderDesc.ball(0.4).setTranslation(0, 0.9, 0),
      peerBody,
    );
    rig.world.step();
    const guardedProbe: StepUpProbe = {
      ...rig.probe,
      lastContactIsCharacter: () => {
        const n = rig.controller.numComputedCollisions();
        for (let i = 0; i < n; i++) {
          if (rig.controller.computedCollision(i)?.collider?.handle === peerBall.handle) {
            return true;
          }
        }
        return false;
      },
    };
    expect(tryGaitStepUp(guardedProbe, dx, 0, { running: true })?.kind).toBe('step');
  });

  it('leaves the probe pose unchanged, leap or not', () => {
    for (const opts of [{}, { ceilingOverTreads: true }]) {
      const rig = makeStairsRig(opts);
      walkToFirstRiser(rig);
      const before = { ...rig.body.translation() };
      expect(tryGaitStepUp(rig.probe, dx, 0, { running: true })).not.toBeNull();
      const after = rig.body.translation();
      expect(after.x).toBeCloseTo(before.x, 9);
      expect(after.y).toBeCloseTo(before.y, 9);
      expect(after.z).toBeCloseTo(before.z, 9);
    }
  });

  it('a running climb walks the leap path to the top in ≈1.0 m rises, never dipping', () => {
    const rig = makeStairsRig();
    const { rises, finalY } = pacedClimb(rig, { x: dx * 2, z: 0 }, true, 1500);
    expect(finalY).toBeGreaterThan(5.4);
    expect(rises).toHaveLength(4);
    for (const rise of rises) {
      expect(rise).toBeCloseTo(1.0, 1);
    }
  });
});

/** Intent per 60 fps frame at 3 m/s, `deg` off straight up the stairs
 * (−X), veering toward +Z. */
function intentAt(deg: number): { x: number; z: number } {
  const rad = (deg * Math.PI) / 180;
  return { x: (-3 / 60) * Math.cos(rad), z: (3 / 60) * Math.sin(rad) };
}

/**
 * Production-shaped movement loop at 60 fps: gravity, the step-up
 * trigger (blocked, or pushing into a riser face — `faceAhead` over
 * the controller's contacts) and the paced traversal. Asserts Y never
 * drops more than 2 cm mid-climb; returns each climb's rise, the max
 * and final body Y.
 */
function pacedClimb(
  rig: Rig,
  move: { x: number; z: number },
  running: boolean,
  frames: number,
): { rises: number[]; maxY: number; finalY: number } {
  const dt = 1 / 60;
  let velY = 0;
  let traversal: StepUpTraversal | null = null;
  const rises: number[] = [];
  let maxY = -Infinity;
  let prevY = rig.body.translation().y;
  for (let i = 0; i < frames && rig.body.translation().x > -0.5; i++) {
    let delta: { x: number; y: number; z: number };
    if (traversal) {
      const step = stepTraversal(traversal, dt, (d) => rig.compute(d));
      delta = step.delta;
      if (step.ended) {
        traversal = null;
      }
    } else {
      velY += -50 * dt;
      const desired = { x: move.x, y: velY * dt, z: move.z };
      const c = rig.compute(desired);
      delta = c;
      if (c.grounded || c.y >= 0) {
        velY = 0;
      }
      const normals = [];
      for (let k = 0; k < rig.controller.numComputedCollisions(); k++) {
        normals.push(rig.controller.computedCollision(k)!.normal1);
      }
      const progress = (c.x * move.x + c.z * move.z) / (move.x ** 2 + move.z ** 2);
      const trigger = stepUpTrigger({
        intent: move,
        blocked: progress < 0.1,
        worldContactNormals: normals,
        touchingCharacter: false,
        grounded: c.grounded,
        airborne: false,
        verticalVel: velY,
      });
      if (trigger) {
        const climb = tryGaitStepUp(rig.probe, move.x, move.z, { running, face: trigger.face });
        if (climb) {
          rises.push(climb.path.rise);
          traversal = new StepUpTraversal(climb.path, (Math.hypot(move.x, move.z) / dt) * 0.7, climb.kind);
          delta = { x: 0, y: 0, z: 0 };
        }
      }
    }
    const t = rig.body.translation();
    rig.setPos({ x: t.x + delta.x, y: t.y + delta.y, z: t.z + delta.z });
    rig.world.step();
    const y = rig.body.translation().y;
    if (traversal) {
      expect(y).toBeGreaterThanOrEqual(prevY - 0.02);
    }
    prevY = y;
    maxY = Math.max(maxY, y);
  }
  return { rises, maxY, finalY: rig.body.translation().y };
}

describe('diagonal stair approaches (real Rapier)', () => {
  it('walking at 45° to the stairs climbs every riser to the top', () => {
    const rig = makeStairsRig({ halfWidth: 6 });
    const { rises, finalY } = pacedClimb(rig, intentAt(45), false, 1500);
    expect(finalY).toBeGreaterThan(5.4);
    expect(rises).toHaveLength(8);
  });

  it('running at 45° leaps two risers at a time to the top', () => {
    const rig = makeStairsRig({ halfWidth: 8 });
    const { rises, finalY } = pacedClimb(
      rig,
      { x: intentAt(45).x * 2, z: intentAt(45).z * 2 },
      true,
      1500,
    );
    expect(finalY).toBeGreaterThan(5.4);
    expect(rises).toHaveLength(4);
  });

  it('a shallow graze at 80° slides along the bottom riser without climbing', () => {
    const rig = makeStairsRig({ halfWidth: 6, startX: 4.45 });
    const before = rig.body.translation();
    const { rises, maxY } = pacedClimb(rig, intentAt(80), false, 90);
    expect(rises).toHaveLength(0);
    expect(maxY).toBeLessThan(2.0);
    expect(rig.body.translation().z - before.z).toBeGreaterThan(3);
  });

  it('a probe sliding along a wall at 45° does not climb the block beside it', () => {
    const rig = makeStairsRig({ halfWidth: 6, wall: true, blockBesideWall: true });
    // Against the wall's face (x=4.6), short of the block (z from 2.95).
    rig.setPos({ x: 5.01, y: 1.5, z: 2.5 });
    rig.world.step();
    const move = intentAt(45);
    const face = { normal: { x: 1, z: 0 }, alignment: Math.SQRT1_2 };
    expect(tryStepUp(rig.probe, move.x, move.z, { face })).toBeNull();
  });

  it('does NOT climb a 2 m wall approached at 45°', () => {
    const rig = makeStairsRig({ halfWidth: 6, wall: true, startX: 5.5 });
    const { rises, maxY } = pacedClimb(rig, intentAt(45), false, 120);
    expect(rises).toHaveLength(0);
    expect(maxY).toBeLessThan(2.0);
  });

  it('stepUpTrigger probes when blocked or facing a riser, only grounded, level and alone', () => {
    const riser = { x: 1, y: 0, z: 0 };
    const frame = {
      intent: { x: -0.05, z: 0.05 },
      blocked: false,
      worldContactNormals: [riser],
      touchingCharacter: false,
      grounded: true,
      airborne: false,
      verticalVel: 0,
    };
    expect(stepUpTrigger(frame)?.face?.alignment).toBeCloseTo(Math.SQRT1_2, 9);
    expect(stepUpTrigger({ ...frame, worldContactNormals: [], blocked: true })).toEqual({ face: null });
    expect(stepUpTrigger({ ...frame, worldContactNormals: [] })).toBeNull();
    expect(stepUpTrigger({ ...frame, touchingCharacter: true })).toBeNull();
    expect(stepUpTrigger({ ...frame, grounded: false })).toBeNull();
    expect(stepUpTrigger({ ...frame, airborne: true })).toBeNull();
    expect(stepUpTrigger({ ...frame, verticalVel: 1 })).toBeNull();
    expect(stepUpTrigger({ ...frame, intent: { x: 0, z: 0 }, blocked: true })).toBeNull();
  });

  it('faceAhead takes faces within 60° of the intent and ignores floors and grazes', () => {
    const riser = { x: 1, y: 0, z: 0 };
    expect(faceAhead([riser], -1, 0)?.alignment).toBeCloseTo(1, 9);
    expect(faceAhead([riser], -1, 1)?.alignment).toBeCloseTo(Math.SQRT1_2, 9);
    expect(faceAhead([riser], -Math.cos(1.1), Math.sin(1.1))).toBeNull();
    expect(faceAhead([{ x: 0, y: 1, z: 0 }], -1, 0)).toBeNull();
    expect(faceAhead([riser], 1, 0)).toBeNull();
    expect(faceAhead([riser], 0, 0)).toBeNull();
  });
});

describe('StepUpTraversal', () => {
  const path = { rise: 0.5, forward: { x: -0.3, z: 0.4 } };

  function walk(traversal: StepUpTraversal, dt: number) {
    const deltas = [];
    const dones = [];
    for (let i = 0; i < 1000; i++) {
      const { delta, done } = traversal.advance(dt);
      deltas.push(delta);
      dones.push(done);
      if (done) break;
    }
    return { deltas, dones };
  }

  it('sums exactly to the path in slices no longer than speed·dt, done once', () => {
    const speed = 1.4;
    const dt = 1 / 60;
    const { deltas, dones } = walk(new StepUpTraversal(path, speed), dt);
    const sum = deltas.reduce(
      (a, d) => ({ x: a.x + d.x, y: a.y + d.y, z: a.z + d.z }),
      { x: 0, y: 0, z: 0 },
    );
    expect(sum.x).toBeCloseTo(path.forward.x, 9);
    expect(sum.y).toBeCloseTo(path.rise, 9);
    expect(sum.z).toBeCloseTo(path.forward.z, 9);
    for (const d of deltas) {
      expect(Math.hypot(d.x, d.y, d.z)).toBeLessThanOrEqual(speed * dt + 1e-12);
    }
    expect(dones.filter(Boolean)).toHaveLength(1);
    expect(dones.at(-1)).toBe(true);
  });

  it('rises before it carries forward, crossing the boundary within one call', () => {
    // 0.3 m of travel per call: call 1 rises 0.3, call 2 rises the last
    // 0.2 then carries 0.1 forward.
    const traversal = new StepUpTraversal(path, 0.3);
    const first = traversal.advance(1).delta;
    expect(first).toEqual({ x: 0, y: 0.3, z: 0 });
    const second = traversal.advance(1).delta;
    expect(second.y).toBeCloseTo(0.2, 9);
    expect(Math.hypot(second.x, second.z)).toBeCloseTo(0.1, 9);
    expect(second.x / 0.1).toBeCloseTo(traversal.forwardDir.x, 9);
    expect(second.z / 0.1).toBeCloseTo(traversal.forwardDir.z, 9);
  });

  it('velocity is the forward direction at climb speed', () => {
    const v = new StepUpTraversal(path, 2).velocity;
    expect(v.x).toBeCloseTo(-1.2, 9);
    expect(v.z).toBeCloseTo(1.6, 9);
    expect(new StepUpTraversal({ rise: 0.5, forward: { x: 0, z: 0 } }, 2).velocity).toEqual({
      x: 0,
      z: 0,
    });
  });

  it('a dt covering the whole path finishes in one call', () => {
    const { deltas, dones } = walk(new StepUpTraversal(path, 1), 10);
    expect(dones).toEqual([true]);
    expect(deltas[0].y).toBeCloseTo(path.rise, 9);
    expect(deltas[0].x).toBeCloseTo(path.forward.x, 9);
    expect(deltas[0].z).toBeCloseTo(path.forward.z, 9);
  });
});

describe('stepTraversal', () => {
  const path = { rise: 0.5, forward: { x: 0.45, z: 0 } };

  it('returns the swept slice and keeps going while the sweep is clear', () => {
    const traversal = new StepUpTraversal(path, 1.4);
    const { delta, ended } = stepTraversal(traversal, 1 / 60, (d) => d);
    expect(delta.y).toBeCloseTo(1.4 / 60, 9);
    expect(ended).toBe(false);
  });

  it('ends when the sweep keeps under half of the slice', () => {
    const traversal = new StepUpTraversal(path, 1.4);
    const swept = (f: number) => (d: { x: number; y: number; z: number }) => ({
      x: d.x * f,
      y: d.y * f,
      z: d.z * f,
    });
    expect(stepTraversal(traversal, 1 / 60, swept(0.6)).ended).toBe(false);
    const cut = stepTraversal(traversal, 1 / 60, swept(0.4));
    expect(cut.ended).toBe(true);
    expect(cut.delta.y).toBeCloseTo((0.4 * 1.4) / 60, 9);
  });

  it('ends on the call that finishes the path', () => {
    const traversal = new StepUpTraversal(path, 1);
    expect(stepTraversal(traversal, 10, (d) => d).ended).toBe(true);
  });
});

describe('climbBroadcast', () => {
  it('scales the climb velocity and faces along it', () => {
    const { vel, yaw } = climbBroadcast({ x: -1, z: 0 }, 1.5, 0.3);
    expect(vel).toEqual({ x: -1.5, y: 0, z: 0 });
    expect(yaw).toBeCloseTo(Math.PI / 2, 9);
  });

  it('keeps the current yaw when the climb has no horizontal carry', () => {
    expect(climbBroadcast({ x: 0, z: 0 }, 1, 0.3).yaw).toBe(0.3);
  });
});
