import type { SceneCommand } from '@officexr/world/scenes';
import { unitFootprint, type FootprintOf, type VoxelBox } from './footprint.ts';

/**
 * Returns a string key uniquely identifying a voxel position.
 * Used to build occupancy sets for collision detection.
 */
export function voxelKey(p: [number, number, number]): string {
  return `${p[0]},${p[1]},${p[2]}`;
}

/** Per-axis voxel footprint of an object. */
export interface VoxelFootprint {
  w: number;
  h: number;
  d: number;
}

function* voxelsOf(box: VoxelBox): Generator<string> {
  for (let x = box.min[0]; x < box.max[0]; x++) {
    for (let y = box.min[1]; y < box.max[1]; y++) {
      for (let z = box.min[2]; z < box.max[2]; z++) {
        yield voxelKey([x, y, z]);
      }
    }
  }
}

/**
 * Checks whether proposed new positions for a set of moving objects
 * would collide with any non-moving objects in the room.
 *
 * Both the moving objects' proposed positions and the existing
 * non-moving objects' positions are expanded into their multi-voxel
 * footprints — a 2 m cube on the 0.5 m grid occupies a 4×4×4 voxel
 * block. The check returns 'blocked' if ANY voxel of a moving
 * footprint overlaps ANY voxel of a non-moving footprint.
 *
 * @param doc - The current room document
 * @param movingIds - Command ids of objects being moved (excluded from
 *   the occupancy set so a moving object doesn't collide with itself)
 * @param proposedPositions - Map of commandId → proposed new position
 * @param movingFootprint - Optional per-axis footprint applied to every
 *   moving object, overriding `footprintOf`.
 * @param footprintOf - Optional footprint lookup, applied to each
 *   command's kind and yaw. Moving objects found in `doc` use it too;
 *   without it (or the command) every object is one voxel.
 * @returns 'ok' if no collision, 'blocked' if any proposed position is occupied
 */
export function checkMoveOccupancy(
  doc: { commands: readonly SceneCommand[] },
  movingIds: ReadonlySet<string>,
  proposedPositions: ReadonlyMap<string, [number, number, number]>,
  movingFootprint?: VoxelFootprint,
  footprintOf: FootprintOf = unitFootprint,
): 'ok' | 'blocked' {
  const occupancy = new Set<string>();
  const moving = new Map<string, { kindId: string; yawDeg?: number }>();
  for (const c of doc.commands) {
    if (c.op !== 'placeObject') continue;
    if (movingIds.has(c.id)) {
      moving.set(c.id, c);
    } else {
      for (const key of voxelsOf(footprintOf(c.position, c.kindId, c.yawDeg))) {
        occupancy.add(key);
      }
    }
  }

  for (const [id, pos] of proposedPositions) {
    const mover = moving.get(id);
    const box = movingFootprint
      ? { min: pos, max: [pos[0] + movingFootprint.w, pos[1] + movingFootprint.h, pos[2] + movingFootprint.d] as const }
      : mover
        ? footprintOf(pos, mover.kindId, mover.yawDeg)
        : unitFootprint(pos);
    for (const key of voxelsOf(box)) {
      if (occupancy.has(key)) {
        return 'blocked';
      }
    }
  }

  return 'ok';
}
