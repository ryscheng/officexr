import type { CubeKindId, PlayerId, Vec3 } from '../game-state/types.ts';

export type Vec2 = { x: number; z: number };

/** Bounding circle in the XZ plane — the uniform broad-phase primitive. */
export type BoundingCircle = { center: Vec2; radius: number };

/** A connected component of same-kind, non-walkable cells. */
export type CollisionGroup = {
  groupId: number;
  kindId: CubeKindId;
  /** (i, j) cell coordinates that belong to this group. */
  cells: Array<{ i: number; j: number }>;
  /** Coarse bound that contains every cell. */
  bound: BoundingCircle;
};

/**
 * Built representation of a {@link WorldMap} that supports O(1) cell lookup
 * during movement resolution. The `cells` buffer is the spatial-partition
 * lookup table: `cells[i * gridSize + j]` is the groupId of the obstacle
 * occupying that cell, or {@link EMPTY_CELL} for walkable / unoccupied.
 */
export type CollisionWorld = {
  gridSize: number;
  cubeSize: number;
  origin: Vec2;
  /** Half side length of the map in world units. Characters are clamped here. */
  halfExtent: number;
  cells: Int32Array;
  groups: CollisionGroup[];
};

export const EMPTY_CELL = -1;

/** Outcome of a {@link resolveMovement} call. */
export type MoveResolution = {
  pos: Vec3;
  /** True if the resolved position differs from the requested `to`. */
  blocked: boolean;
  /** Why the move was blocked, if it was. */
  contact?: 'obstacle' | 'character' | 'bounds';
  /** Unit XZ normal at the contact point — only present if `blocked`. */
  normal?: Vec2;
  /** If a char-vs-char collision occurred, who we hit. */
  otherId?: PlayerId;
};

export type OtherCharacter = {
  id: PlayerId;
  pos: Vec3;
  radius: number;
};
