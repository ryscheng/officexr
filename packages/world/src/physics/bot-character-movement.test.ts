/**
 * BotCharacterMovement unit tests.
 *
 * These run against a real Rapier world (via setup-rapier.ts global init)
 * so physics behaviour (gravity, ground contact, floor probe) is
 * authoritative rather than mocked.
 *
 * Scene geometry used across tests:
 *   - A flat platform: cuboid half-extents (2, 0.25, 2), center (0, -0.25, 0).
 *     Top face is at y=0. Characters placed above y=0 will fall onto it.
 *   - A wall for the "blocked walk" test: placed directly ahead of the character.
 *
 * Character start positions are set per-test as noted in each describe block.
 */

import { describe, it, expect } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { BotPhysicsWorld } from '../bot/BotPhysicsWorld.ts';
import { BotCharacterMovement } from './bot-character-movement.ts';
import type { CharacterMoveResult } from './character-movement.ts';

// Default tunables used across most tests.
const DEFAULT_TUNABLES = {
  walkSpeed: 2.0,
  runSpeed: 4.0,
  movementBlockThreshold: 0.9,
};

// World settings matching BotPhysicsWorld constructor requirements.
const WORLD_SETTINGS = {
  charRadius: 0.35,
  proximityRadius: 1.0,
  proximityOuterRadius: 2.0,
};

// dt for a 60 fps frame.
const DT_SEC = 1 / 60;

/** Access the private Rapier World through the BotPhysicsWorld. */
function rapierWorldOf(physics: BotPhysicsWorld): RAPIER.World {
  return (physics as unknown as { world: RAPIER.World }).world;
}

/** Build a physics world with a flat platform and a bot above it. */
function makePlatformWorld(startPos = { x: 0, y: 2, z: 0 }): {
  physics: BotPhysicsWorld;
  movement: BotCharacterMovement;
} {
  const physics = new BotPhysicsWorld({
    selfId: 'test-bot',
    startPos,
    worldSettings: WORLD_SETTINGS,
  });

  // Flat platform: top face at y=0. Characters placed above y=0 fall onto it.
  const rw = rapierWorldOf(physics);
  const platformBody = rw.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.25, 0),
  );
  rw.createCollider(RAPIER.ColliderDesc.cuboid(2, 0.25, 2), platformBody);

  // Step the world once so the newly-created fixed bodies register
  // in the broad-phase / query pipeline before any ray casts run.
  rw.step();

  const movement = new BotCharacterMovement(physics, DEFAULT_TUNABLES);
  return { physics, movement };
}

/** Build a physics world with no floor (open air). */
function makeOpenAirWorld(startPos = { x: 0, y: 50, z: 0 }): {
  physics: BotPhysicsWorld;
  movement: BotCharacterMovement;
} {
  const physics = new BotPhysicsWorld({
    selfId: 'test-bot',
    startPos,
    worldSettings: WORLD_SETTINGS,
  });
  // No floor — character is in open air.
  const movement = new BotCharacterMovement(physics, DEFAULT_TUNABLES);
  return { physics, movement };
}

/** Step N ticks; call physics.stepWorld() after each to advance the sim. */
function stepN(
  movement: BotCharacterMovement,
  physics: BotPhysicsWorld,
  verb: 'stop' | 'walk' | 'run',
  n: number,
  dir = { x: 0, z: 1 },
): CharacterMoveResult {
  let result!: CharacterMoveResult;
  for (let i = 0; i < n; i++) {
    if (verb === 'stop') {
      result = movement.stop(0, DT_SEC);
    } else if (verb === 'walk') {
      result = movement.walk(dir, 0, DT_SEC);
    } else {
      result = movement.run(dir, 0, DT_SEC);
    }
    physics.stepWorld();
  }
  return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BotCharacterMovement', () => {
  describe('1. walk() moves character', () => {
    it('character moves in the +z direction and animState is walk', () => {
      const { physics, movement } = makePlatformWorld({ x: 0, y: 0.5, z: -3 });

      // Let character settle onto the platform first (20 ticks).
      stepN(movement, physics, 'stop', 20);

      const startPos = physics.translation();
      const dir = { x: 0, z: 1 };

      // Walk for 30 ticks.
      const lastResult = stepN(movement, physics, 'walk', 30, dir);

      expect(lastResult.newPos.z).toBeGreaterThan(startPos.z);
      expect(lastResult.animState).toBe('walk');
    });
  });

  describe('2. stop() keeps animState idle', () => {
    it('stop() returns animState idle and zero broadcastVel', () => {
      const { physics, movement } = makePlatformWorld({ x: 0, y: 0.5, z: 0 });

      // Settle onto platform.
      stepN(movement, physics, 'stop', 20);

      const result = movement.stop(0, DT_SEC);

      expect(result.animState).toBe('idle');
      expect(result.broadcastVel.x).toBeCloseTo(0);
      expect(result.broadcastVel.y).toBeCloseTo(0);
      expect(result.broadcastVel.z).toBeCloseTo(0);
    });
  });

  describe('3. blocked walk → animState idle', () => {
    it('walk blocked by wall returns animState idle', () => {
      // Character starts immediately against a wall (z=0, wall face at z=0.4).
      // Walking +z. With movementBlockThreshold=0.9, if < 10% of intent
      // survives contact the step is treated as fully blocked → idle.
      const physics = new BotPhysicsWorld({
        selfId: 'test-bot',
        // Start character pressed hard against the wall — only 0.05 m clearance.
        startPos: { x: 0, y: 0.5, z: -0.05 },
        worldSettings: WORLD_SETTINGS,
      });

      const rw = rapierWorldOf(physics);

      // Platform under character.
      const platform = rw.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.25, 0),
      );
      rw.createCollider(RAPIER.ColliderDesc.cuboid(2, 0.25, 2), platform);

      // Wall directly in the +z path. Place it at z=0.4 so the character's
      // collider (ball radius 0.35, origin at body y=0.5) is already in
      // contact. Half-extent z=1.0 makes it effectively infinite in z.
      const wallBody = rw.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(0, 1, 1.4),
      );
      rw.createCollider(
        RAPIER.ColliderDesc.cuboid(2, 2, 1.0),
        wallBody,
      );

      // Step once so newly-created bodies register in the query pipeline.
      rw.step();

      const movement = new BotCharacterMovement(physics, {
        ...DEFAULT_TUNABLES,
        movementBlockThreshold: 0.9,
      });

      // Settle onto platform (gravity still applies even when pressed against wall).
      stepN(movement, physics, 'stop', 20);

      // Walk toward wall (+z) — should be fully blocked.
      const dir = { x: 0, z: 1 };
      let lastResult!: CharacterMoveResult;
      for (let i = 0; i < 10; i++) {
        lastResult = movement.walk(dir, 0, DT_SEC);
        physics.stepWorld();
      }

      // Should be blocked — animState idle, not walk.
      expect(lastResult.animState).toBe('idle');
    });
  });

  describe('4. velY accumulates gravity', () => {
    it('velY becomes increasingly negative over time in open air', () => {
      const { physics, movement } = makeOpenAirWorld();

      const velYs: number[] = [];
      for (let i = 0; i < 30; i++) {
        const result = movement.stop(0, DT_SEC);
        velYs.push(result.velY);
        physics.stepWorld();
      }

      // velY should be negative (falling).
      expect(velYs[velYs.length - 1]).toBeLessThan(0);
      // Magnitude should increase over time.
      expect(Math.abs(velYs[29])).toBeGreaterThan(Math.abs(velYs[10]));
    });
  });

  describe('5. velY resets on landing', () => {
    it('velY is near zero once character is grounded', () => {
      const { physics, movement } = makePlatformWorld({ x: 0, y: 3, z: 0 });

      // Fall for many ticks until grounded.
      let lastResult!: CharacterMoveResult;
      for (let i = 0; i < 180; i++) {
        lastResult = movement.stop(0, DT_SEC);
        physics.stepWorld();
        if (lastResult.isGrounded) break;
      }

      expect(lastResult.isGrounded).toBe(true);
      expect(Math.abs(lastResult.velY)).toBeLessThanOrEqual(0.01);
    });
  });

  describe('6. hasFloorUnderneath true above platform', () => {
    it('returns hasFloorUnderneath true when above platform within FLOOR_PROBE_RANGE', () => {
      // Character at y=0.5, platform top at y=0 → 0.5m gap, within FLOOR_PROBE_RANGE (2m).
      // makePlatformWorld already calls rw.step() so the platform is in the query pipeline.
      const { physics, movement } = makePlatformWorld({ x: 0, y: 0.5, z: 0 });

      const result = movement.stop(0, DT_SEC);
      expect(result.hasFloorUnderneath).toBe(true);
    });
  });

  describe('7. hasFloorUnderneath false in open air', () => {
    it('returns hasFloorUnderneath false with no surface within FLOOR_PROBE_RANGE', () => {
      // Start at y=50 — no floor within 2 m.
      const { movement } = makeOpenAirWorld({ x: 0, y: 50, z: 0 });

      const result = movement.stop(0, DT_SEC);
      expect(result.hasFloorUnderneath).toBe(false);
    });
  });

  describe('8. CharacterMoveResult shape', () => {
    it('result has all required fields', () => {
      const { physics, movement } = makePlatformWorld();
      const result = movement.stop(0, DT_SEC);

      const requiredFields: Array<keyof CharacterMoveResult> = [
        'newPos',
        'broadcastVel',
        'broadcastYaw',
        'moved',
        'animState',
        'velY',
        'hasFloorUnderneath',
        'isGrounded',
        'bumps',
      ];
      for (const field of requiredFields) {
        expect(result).toHaveProperty(field);
      }

      // newPos has x, y, z.
      expect(result.newPos).toHaveProperty('x');
      expect(result.newPos).toHaveProperty('y');
      expect(result.newPos).toHaveProperty('z');

      // broadcastVel has x, y, z.
      expect(result.broadcastVel).toHaveProperty('x');
      expect(result.broadcastVel).toHaveProperty('y');
      expect(result.broadcastVel).toHaveProperty('z');

      // bumps is an array.
      expect(Array.isArray(result.bumps)).toBe(true);

      // Suppress unused-variable lint.
      void physics;
    });
  });

  describe('9. run() uses run speed', () => {
    it('run() produces greater broadcastVel than walk() in the same conditions', () => {
      // Both characters start from identical conditions; run should yield a
      // strictly higher broadcastVel magnitude than walk. This verifies that
      // BotCharacterMovement honours runSpeed vs walkSpeed from the tunables.
      //
      // Note: we do NOT assert broadcastVel ≈ exactSpeed because Rapier's
      // `progress` factor (sqrt of corrected/intent ratio) is non-linear for
      // large step sizes — the ratio doesn't scale cleanly 1:1 with speed.
      // The ordering invariant is the meaningful test.
      const { physics: pRun, movement: mRun } = makePlatformWorld({ x: 0, y: 0.5, z: 0 });
      const { physics: pWalk, movement: mWalk } = makePlatformWorld({ x: 0, y: 0.5, z: 0 });

      stepN(mRun, pRun, 'stop', 20);
      stepN(mWalk, pWalk, 'stop', 20);

      const dir = { x: 0, z: 1 };
      const runResult = mRun.run(dir, 0, DT_SEC);
      const walkResult = mWalk.walk(dir, 0, DT_SEC);

      const runVel = Math.abs(runResult.broadcastVel.z);
      const walkVel = Math.abs(walkResult.broadcastVel.z);

      // Run speed must be strictly greater than walk speed.
      expect(runVel).toBeGreaterThan(walkVel);
      // Both must be positive (character is moving, not blocked).
      expect(runVel).toBeGreaterThan(0);
    });
  });

  describe('10. walk() uses walk speed', () => {
    it('broadcastVel.z is non-zero and less than runSpeed for an unblocked tick', () => {
      const { physics, movement } = makePlatformWorld({ x: 0, y: 0.5, z: 0 });

      stepN(movement, physics, 'stop', 20);

      const dir = { x: 0, z: 1 };
      const result = movement.walk(dir, 0, DT_SEC);

      // broadcastVel.z should be non-zero (character is moving) and
      // less than runSpeed (it's not running).
      expect(Math.abs(result.broadcastVel.z)).toBeGreaterThan(0);
      expect(Math.abs(result.broadcastVel.z)).toBeLessThan(DEFAULT_TUNABLES.runSpeed);
    });
  });
});
