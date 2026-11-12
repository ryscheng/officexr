import type { SceneCommand } from '@officexr/world/scenes';
import type { VoxelFootprint } from '@officexr/world/app';
import { boxesOverlap, type FootprintOf } from './footprint.ts';

/**
 * Checks whether proposed new positions for a set of moving objects
 * would collide with any non-moving objects in the room.
 *
 * Both the moving objects' proposed positions and the existing
 * non-moving objects' positions are expanded into their footprints — a
 * 2 m cube on the 0.5 m grid occupies a 4×4×4 voxel block; a sub-grid
 * placement or a thin kind occupies its exact box (see
 * `createFootprintOf`). The check returns 'blocked' if ANY moving
 * footprint shares volume with ANY non-moving footprint.
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
  const occupied: VoxelFootprint[] = [];
  const moving = new Map<string, { kindId: string; yawDeg?: number }>();
  for (const c of doc.commands) {
    if (c.op !== 'placeObject') continue;
    if (movingIds.has(c.id)) {
      moving.set(c.id, c);
    } else {
      occupied.push(footprintOf(c.position, c.kindId, c.yawDeg));
    }
  }

  for (const [id, pos] of proposedPositions) {
    const mover = moving.get(id);
    if (!mover) continue;
    const box = footprintOf(pos, mover.kindId, mover.yawDeg);
    if (occupied.some((fp) => boxesOverlap(box, fp))) {
      return 'blocked';
    }
  }

  return 'ok';
}
