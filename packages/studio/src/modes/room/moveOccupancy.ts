import type { SceneCommand } from '@officexr/world/scenes';
import type { VoxelFootprint } from '@officexr/world/app';
import type { FootprintOf } from './footprint.ts';

/**
 * Returns a string key uniquely identifying a voxel position.
 * Used to build occupancy sets for collision detection.
 */
export function voxelKey(p: [number, number, number]): string {
  return `${p[0]},${p[1]},${p[2]}`;
}

function* voxelsOf(box: VoxelFootprint): Generator<string> {
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
 * @param footprintOf - Footprint lookup, applied to each command's kind
 *   and yaw. Moving objects use it at their proposed position.
 * @returns 'ok' if no collision, 'blocked' if any proposed position is occupied
 */
export function checkMoveOccupancy(
  doc: { commands: readonly SceneCommand[] },
  movingIds: ReadonlySet<string>,
  proposedPositions: ReadonlyMap<string, [number, number, number]>,
  footprintOf: FootprintOf,
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
    if (!mover) continue;
    const box = footprintOf(pos, mover.kindId, mover.yawDeg);
    for (const key of voxelsOf(box)) {
      if (occupancy.has(key)) {
        return 'blocked';
      }
    }
  }

  return 'ok';
}
