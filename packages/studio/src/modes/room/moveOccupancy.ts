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
 * @param footprint - Optional multi-voxel footprint in voxels (w × h × d).
 *   When provided, the occupancy check tests all voxels in the footprint
 *   [x, x+w), [y, y+h), [z, z+d) for each proposed position.
 *   Defaults to {w:1, h:1, d:1} (1-voxel check, existing behavior).
 * @returns 'ok' if no collision, 'blocked' if any proposed position is occupied
 */
export function checkMoveOccupancy(
  doc: RoomDocument,
  movingIds: ReadonlySet<string>,
  proposedPositions: ReadonlyMap<string, [number, number, number]>,
  footprint?: { w: number; h: number; d: number },
): 'ok' | 'blocked' {
  const fw = footprint?.w ?? 1;
  const fh = footprint?.h ?? 1;
  const fd = footprint?.d ?? 1;

  // Build occupancy set from all non-moving placeObject commands
  const occupancy = new Set(
    doc.commands
      .filter((c) => c.op === 'placeObject' && !movingIds.has(c.id))
      .map((c) => voxelKey((c as { position: [number, number, number] }).position)),
  );

  // Check each proposed position against the occupancy set.
  // For a multi-voxel footprint, check all voxels in [x, x+w) × [y, y+h) × [z, z+d).
  for (const pos of proposedPositions.values()) {
    for (let dx = 0; dx < fw; dx++) {
      for (let dy = 0; dy < fh; dy++) {
        for (let dz = 0; dz < fd; dz++) {
          const voxel: [number, number, number] = [pos[0] + dx, pos[1] + dy, pos[2] + dz];
          if (occupancy.has(voxelKey(voxel))) {
            return 'blocked';
          }
        }
      }
    }
  }

  return 'ok';
}
