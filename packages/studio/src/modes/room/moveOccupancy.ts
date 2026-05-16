import type { RoomDocument } from '@officexr/world/scenes';

/**
 * Returns a string key uniquely identifying a voxel position.
 * Used to build occupancy sets for collision detection.
 */
export function voxelKey(p: [number, number, number]): string {
  return `${p[0]},${p[1]},${p[2]}`;
}

/**
 * Checks whether proposed new positions for a set of moving objects
 * would collide with any non-moving objects in the room.
 *
 * @param doc - The current room document
 * @param movingIds - Command ids of objects being moved (excluded from occupancy)
 * @param proposedPositions - Map of commandId → proposed new position
 * @returns 'ok' if no collision, 'blocked' if any proposed position is occupied
 */
export function checkMoveOccupancy(
  doc: RoomDocument,
  movingIds: ReadonlySet<string>,
  proposedPositions: ReadonlyMap<string, [number, number, number]>,
): 'ok' | 'blocked' {
  // Build occupancy set from all non-moving placeCube commands
  const occupancy = new Set(
    doc.commands
      .filter((c) => c.op === 'placeCube' && !movingIds.has(c.id))
      .map((c) => voxelKey((c as { position: [number, number, number] }).position)),
  );

  // Check each proposed position against the occupancy set
  for (const position of proposedPositions.values()) {
    if (occupancy.has(voxelKey(position))) {
      return 'blocked';
    }
  }

  return 'ok';
}
