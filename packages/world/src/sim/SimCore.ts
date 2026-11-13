import type { PlayerId, Vec3, WorldObjects, WorldSettings } from '@officexr/sdk';
import type { CharacterMoveResult } from '../physics/character-movement.ts';
import type { ColliderDescriptor } from '../physics/rules.ts';
import type { WorldObjectKind } from '../scenes/world-object-kinds-schema.ts';

/** The kind fields static colliders derive from, with the voxel size instance positions are in. */
export interface SimKinds {
  voxelSize: number;
  kinds: ReadonlyArray<Pick<WorldObjectKind, 'id' | 'localAABB' | 'dimensions' | 'colliderShape'>>;
}

/**
 * A baked layout's layout-local colliders and its placement. Its room's
 * instances in `worldObjects` collide through these instead, also while
 * `colliders` is still empty because the GLB hasn't loaded.
 */
export interface SimBakedColliders {
  roomInstanceId: string;
  position: Vec3;
  yawRad: number;
  colliders: readonly ColliderDescriptor[];
}

export interface SimPeer {
  id: PlayerId;
  /** Body-root position this frame; the mirror moves there for the next step. */
  pos: Vec3;
}

export type SimSettings = Pick<
  WorldSettings,
  'charRadius' | 'movementBlockThreshold' | 'jumpVelocity' | 'airControl' | 'maxJumps' | 'landingEaseMs'
>;

/** One frame of the local player's intent, as plain data. */
export interface SimInput {
  dtSec: number;
  nowMs: number;
  /** World-space unit XZ direction to move in, or zero for none. */
  dir: { x: number; z: number };
  /** Horizontal speed (m/s) along `dir`. */
  speed: number;
  /** Only picks the `animState` of a successful move. */
  running: boolean;
  /** Yaw to broadcast. */
  yaw: number;
  /** Jump was pressed this frame (edge, not held). */
  jump: boolean;
  settings: SimSettings;
  /** Where a fallen player respawns; empty means never. */
  spawnPoints: readonly Vec3[];
}

export interface SimStepResult extends CharacterMoveResult {
  /** Airborne as of the start of the step: what the move broadcasts and animates. */
  isAirborne: boolean;
  /** The player fell off the map and `newPos` is a spawn point. */
  respawned: boolean;
}

/**
 * The local player's deterministic movement simulation: its own physics
 * world of static colliders and peer mirrors, and the character step.
 * Every input is plain data and no implementation reads a clock.
 */
export interface SimCore {
  setStaticColliders(
    worldObjects: WorldObjects,
    kinds: SimKinds,
    bakedColliders: readonly SimBakedColliders[],
  ): void;
  /** Peers absent from `peers` lose their mirrors. */
  syncPeers(peers: readonly SimPeer[], charRadius: number): void;
  step(input: SimInput): SimStepResult;
  /** The player's body-root position as of the last step or teleport. */
  position(): Vec3;
  /** Moves the player to `pos` and clears its fall and jump state. */
  teleport(pos: Vec3): void;
  /** Off pins the player: no gravity and no jumping. */
  setGravityEnabled(on: boolean): void;
  dispose(): void;
}
