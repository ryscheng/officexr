/**
 * CharacterMovement — the intent-command API for character locomotion.
 *
 * Every character in the world (human player, bot) moves through this
 * interface each tick. The caller is an INTENT SOURCE (keyboard input,
 * a bot mode strategy). The implementer owns: physics step, gravity
 * integration, collision resolution, snap-to-ground, floor probe, and
 * dual-gate fall-respawn gating.
 *
 * DIP: this file lives in the headless physics layer. It has no Three,
 * no React, no r3f imports. SceneFrame (React) and BotDriver (Rapier)
 * depend on this interface — not the reverse.
 *
 * SRP: the interface owns only "intent verb → corrected move + state".
 * Broadcasting, store updates, and bus events are the caller's concern.
 *
 * OCP: new verbs (crouch, dash) are additive — add a method and a new
 * 'animState' literal; existing consumers need not change.
 */

import type { Vec3 } from '@officexr/sdk';

/**
 * The result every verb method returns. Callers use this to:
 *   - apply the new position to the physics body / store
 *   - derive broadcast vel and yaw for peers
 *   - check whether a respawn should fire
 *   - select the animation state for the character avatar
 */
export interface CharacterMoveResult {
  /** Physics-corrected new world-space position. */
  newPos: Vec3;
  /** Velocity to broadcast to peers (for extrapolation + animation). */
  broadcastVel: Vec3;
  /** Yaw (facing direction) to broadcast. Unchanged for stop(). */
  broadcastYaw: number;
  /** True if the character actually moved this tick (not fully blocked). */
  moved: boolean;
  /** Animation state derived from the verb and whether the move succeeded. */
  animState: 'idle' | 'walk' | 'run';
  /** Current integrated vertical velocity (m/s, negative = falling). */
  velY: number;
  /** True if the downward floor probe finds a surface within FLOOR_PROBE_RANGE. */
  hasFloorUnderneath: boolean;
  /** True if the Rapier controller reports the character is on solid ground. */
  isGrounded: boolean;
  /** Bump events from this step (edge-triggered, for bus emission). */
  bumps: Array<{ otherId: string; normal: { x: number; z: number } }>;
}

/**
 * Intent-command interface. One implementation per physics context
 * (BotCharacterMovement for headless Rapier; SceneFrameCharacterMovement
 * for the r3f-hosted Rapier world inside the Canvas).
 *
 * OCP design note: `dtSec` is part of every verb so that each
 * implementation can integrate gravity and compute physics-correct deltas
 * internally, without the caller needing to manage a separate "set dt"
 * lifecycle call. New verbs (crouch, dash) add a method without touching
 * existing callers.
 */
export interface CharacterMovement {
  /**
   * Walk in the given unit XZ direction at walk speed.
   * @param dir - Unit XZ direction vector. Normalized defensively inside.
   * @param currentYaw - Current facing yaw (used as fallback if blocked).
   * @param dtSec - Frame delta in seconds.
   */
  walk(dir: { x: number; z: number }, currentYaw: number, dtSec: number): CharacterMoveResult;

  /**
   * Run in the given unit XZ direction at run speed.
   * @param dir - Unit XZ direction vector. Normalized defensively inside.
   * @param currentYaw - Current facing yaw.
   * @param dtSec - Frame delta in seconds.
   */
  run(dir: { x: number; z: number }, currentYaw: number, dtSec: number): CharacterMoveResult;

  /**
   * No horizontal intent this tick. Gravity and floor probe still apply.
   * @param currentYaw - Current facing yaw (preserved in result).
   * @param dtSec - Frame delta in seconds.
   */
  stop(currentYaw: number, dtSec: number): CharacterMoveResult;

  /** Force the character to a new world position; zero vertical velocity. */
  teleport(pos: Vec3): void;

  /** Current world-space position. */
  getPosition(): Vec3;
}
