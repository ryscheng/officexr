/**
 * Pure gravity-placement helper for the Room editor.
 *
 * A gravity-enabled object may only rest on top of another placed
 * object's surface. The world floor (y = 0) is NOT a valid support —
 * if no supporting object exists beneath the proposed footprint the
 * function returns `null` and the placement is rejected.
 */

/**
 * Computes the settled voxel Y position for a gravity-enabled object
 * being placed at `proposedVoxel`. Returns `null` when no supporting
 * object exists beneath the proposed footprint.
 *
 * Algorithm:
 *   1. Find all existing instances whose voxel XZ footprint overlaps
 *      the proposed XZ footprint AND whose voxel Y is strictly less
 *      than `proposedVoxel[1]`.
 *   2. If none, return `null` (placement is invalid — no support).
 *   3. `settledY = max(overlapping iy) + 1` (rest one voxel above the
 *      highest support).
 *   4. Returns `[proposedVoxel[0], settledY, proposedVoxel[2]]`.
 *
 * XZ overlap: the footprint is `objectFootprint.w` wide (X) and
 * `objectFootprint.d` deep (Z), centered on the proposed voxel.
 * An instance at `[ix, iy, iz]` overlaps when:
 *   ix >= proposedVoxel[0] - floor(w/2)  AND  ix < proposedVoxel[0] + ceil(w/2)
 *   iz >= proposedVoxel[2] - floor(d/2)  AND  iz < proposedVoxel[2] + ceil(d/2)
 *
 * @param proposedVoxel - The voxel position where the user clicked to place
 * @param objectFootprint - Width and depth in voxels (use computeTileStep)
 * @param worldObjects - The current compiled scene (existing placed objects).
 *   `voxelSize` is carried for future compatibility but not used here —
 *   all arithmetic is in voxel coords.
 */
export function dropToSurface(
  proposedVoxel: [number, number, number],
  objectFootprint: { w: number; d: number },
  worldObjects: {
    instances: ReadonlyArray<{ position: readonly [number, number, number] }>;
  },
): [number, number, number] | null {
  const [px, py, pz] = proposedVoxel;
  const { w, d } = objectFootprint;

  // Half-extents (integer, centered on px/pz)
  const xMin = px - Math.floor(w / 2);
  const xMax = px + Math.ceil(w / 2);
  const zMin = pz - Math.floor(d / 2);
  const zMax = pz + Math.ceil(d / 2);

  let maxSupportY = -Infinity;

  for (const inst of worldObjects.instances) {
    const [ix, iy, iz] = inst.position;
    // Only look downward
    if (iy >= py) continue;
    // Check XZ overlap
    if (ix < xMin || ix >= xMax) continue;
    if (iz < zMin || iz >= zMax) continue;
    if (iy > maxSupportY) maxSupportY = iy;
  }

  if (maxSupportY === -Infinity) {
    // No supporting object found — placement rejected
    return null;
  }

  return [px, maxSupportY + 1, pz];
}
