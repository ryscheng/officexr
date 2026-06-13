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
  tryStepUp,
  type StepUpProbe,
} from './step-up.ts';
import { CHARACTER_CONTROLLER_SKIN } from './rules.ts';

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
function makeStairsRig(opts?: { wall?: boolean; ceiling?: boolean; startX?: number }): Rig {
  const world = new RAPIER.World({ x: 0, y: -50, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(2, 1, 2).setTranslation(6, 1, 2));
  world.createCollider(RAPIER.ColliderDesc.cuboid(2, 3, 2).setTranslation(-2, 3, 2));
  for (let k = 0; k < 8; k++) {
    const x0 = 4 - (k + 1) * 0.5;
    const x1 = 4 - k * 0.5;
    const top = 2 + (k + 1) * 0.5;
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.25, top / 2, 2).setTranslation((x0 + x1) / 2, top / 2, 2),
    );
  }
  if (opts?.wall) {
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.1, 2, 2).setTranslation(4.5, 4, 2));
  }
  if (opts?.ceiling) {
    world.createCollider(RAPIER.ColliderDesc.cuboid(2, 0.1, 2).setTranslation(3, 3.0, 2));
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
        c = { ...hop, grounded: true };
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
