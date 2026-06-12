/**
 * BotCharacterMovement — concrete CharacterMovement for the headless
 * Rapier world used by BotDriver.
 *
 * SRP: this class owns "physics intent → corrected result" for bots.
 *   Gravity integration lives in BotPhysicsWorld.step(). Broadcasting,
 *   store writes, and event routing remain in BotDriver.
 *
 * DIP: no Three, no React. BotDriver (high-level) depends on this class
 *   and on the CharacterMovement interface; this class depends on the
 *   low-level BotPhysicsWorld — never the reverse.
 *
 * OCP: new verbs (run, crouch, dash) extend without modifying existing
 *   ones. New callers implement CharacterMovement; no BotDriver changes
 *   needed for each new verb.
 */

import type { Vec3 } from '@officexr/sdk';
import { FLOOR_PROBE_RANGE } from './rules.ts';
import type { CharacterMovement, CharacterMoveResult } from './character-movement.ts';
import type { BotPhysicsWorld } from '../bot/BotPhysicsWorld.ts';

export interface BotMovementTunables {
  walkSpeed: number;
  runSpeed: number;
  /**
   * Fraction of the horizontal intent that must be BLOCKED before the
   * controller treats the character as "fully stopped". Same semantic
   * as `movementBlockThreshold` in WorldSettings. A value of 0.9 means
   * "if less than 10 % of intent survived, treat as blocked / idle."
   */
  movementBlockThreshold: number;
}

export class BotCharacterMovement implements CharacterMovement {
  constructor(
    private readonly physics: BotPhysicsWorld,
    private tunables: BotMovementTunables,
  ) {}

  /** Called by BotDriver.tick() before each step to apply the latest tunables. */
  updateTunables(t: BotMovementTunables): void {
    this.tunables = t;
  }

  walk(dir: { x: number; z: number }, currentYaw: number, dtSec: number): CharacterMoveResult {
    return this._step(dir, this.tunables.walkSpeed, 'walk', currentYaw, dtSec);
  }

  run(dir: { x: number; z: number }, currentYaw: number, dtSec: number): CharacterMoveResult {
    return this._step(dir, this.tunables.runSpeed, 'run', currentYaw, dtSec);
  }

  stop(currentYaw: number, dtSec: number): CharacterMoveResult {
    return this._step(null, 0, 'idle', currentYaw, dtSec);
  }

  teleport(pos: Vec3): void {
    this.physics.teleport(pos);
  }

  getPosition(): Vec3 {
    return this.physics.translation();
  }

  private _step(
    dir: { x: number; z: number } | null,
    speed: number,
    verb: 'walk' | 'run' | 'idle',
    currentYaw: number,
    dtSec: number,
  ): CharacterMoveResult {
    // 1. Normalize dir defensively (guard against un-normalised callers).
    let normalDir = dir;
    if (dir !== null) {
      const len = Math.hypot(dir.x, dir.z);
      if (len > 1e-9) {
        normalDir = { x: dir.x / len, z: dir.z / len };
      } else {
        // Zero-length direction — treat as stop.
        normalDir = null;
      }
    }

    // 2. Compute per-frame horizontal deltas (metres, pre-multiplied by dt).
    const moveDX = normalDir ? normalDir.x * speed * dtSec : 0;
    const moveDZ = normalDir ? normalDir.z * speed * dtSec : 0;

    // 3. Step physics (gravity integrated inside BotPhysicsWorld.step).
    const stepResult = this.physics.step({ x: moveDX, z: moveDZ, dtSec });

    // 4. Authoritative vertical velocity from the physics world (replaces
    //    the corrected.y / dtSec approximation that BotDriver used to use).
    const velY = this.physics.getVerticalVel();

    // 5. Floor probe from the physics world.
    const currentPos = this.physics.translation();
    const hasFloorUnderneath = this.physics.probeFloor(currentPos, FLOOR_PROBE_RANGE);

    // 6. Determine if horizontal movement actually happened.
    const minProgress = 1 - this.tunables.movementBlockThreshold;
    const moved = normalDir !== null && stepResult.progress >= minProgress;

    // 7. Derive animation state: verb if moved, otherwise idle.
    const animState: 'idle' | 'walk' | 'run' =
      moved ? (verb === 'idle' ? 'idle' : verb) : 'idle';

    // 8. Derive broadcastVel and broadcastYaw.
    let broadcastVel: Vec3;
    let broadcastYaw: number;
    if (moved && normalDir !== null) {
      broadcastVel = {
        x: normalDir.x * speed * stepResult.progress,
        y: 0,
        z: normalDir.z * speed * stepResult.progress,
      };
      broadcastYaw = Math.atan2(-normalDir.x, -normalDir.z);
    } else {
      broadcastVel = { x: 0, y: 0, z: 0 };
      broadcastYaw = currentYaw;
    }

    // 9. Compute newPos.
    //    When blocked, keep x/z from the current translation (slide aborted),
    //    but still apply the gravity-driven y delta so the bot falls correctly.
    let newPos: Vec3;
    if (!moved) {
      newPos = {
        x: currentPos.x,
        y: currentPos.y + stepResult.corrected.y,
        z: currentPos.z,
      };
    } else {
      newPos = {
        x: currentPos.x + stepResult.corrected.x,
        y: currentPos.y + stepResult.corrected.y,
        z: currentPos.z + stepResult.corrected.z,
      };
    }

    // 10. Apply the computed translation to the physics body.
    this.physics.applyTranslation(newPos);

    return {
      newPos,
      broadcastVel,
      broadcastYaw,
      moved,
      animState,
      velY,
      hasFloorUnderneath,
      isGrounded: stepResult.grounded,
      bumps: stepResult.bumps,
    };
  }
}
