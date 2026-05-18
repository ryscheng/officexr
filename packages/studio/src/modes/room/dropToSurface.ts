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
/** Footprint lookup matching `InstanceGeometryService.voxelFootprint`.
 * Callers with an application api in scope pass it through; the legacy
 * default treats every existing instance as one voxel — preserved for
 * tests that don't have a catalog. */
export interface InstanceFootprintLookup {
  (
    position: readonly [number, number, number],
    kindId: string,
  ): {
    min: readonly [number, number, number];
    max: readonly [number, number, number]; // exclusive
  };
}

export function dropToSurface(
  proposedVoxel: [number, number, number],
  objectFootprint: { w: number; d: number },
  worldObjects: {
    instances: ReadonlyArray<{
      position: readonly [number, number, number];
      kindId: string;
    }>;
  },
  footprintOf?: InstanceFootprintLookup,
): [number, number, number] | null {
  const [px, py, pz] = proposedVoxel;
  const { w, d } = objectFootprint;

  // Proposed object's XZ footprint, centered on px / pz.
  const xMin = px - Math.floor(w / 2);
  const xMax = px + Math.ceil(w / 2);
  const zMin = pz - Math.floor(d / 2);
  const zMax = pz + Math.ceil(d / 2);

  let maxSupportTop = -Infinity;

  for (const inst of worldObjects.instances) {
    const fp = footprintOf
      ? footprintOf(inst.position, inst.kindId)
      : {
          // Legacy fallback: treat the existing instance as a single
          // voxel at its anchor position.
          min: [inst.position[0], inst.position[1], inst.position[2]] as const,
          max: [
            inst.position[0] + 1,
            inst.position[1] + 1,
            inst.position[2] + 1,
          ] as const,
        };
    // Only look downward — the instance's top face must be at or
    // below the proposed Y.
    if (fp.max[1] > py) continue;
    // Check XZ overlap of the proposed footprint with the instance's
    // full voxel footprint.
    if (fp.max[0] <= xMin || fp.min[0] >= xMax) continue;
    if (fp.max[2] <= zMin || fp.min[2] >= zMax) continue;
    // Instance's top voxel Y (max is exclusive → top voxel = max-1,
    // and the SURFACE the new object sits on is the row above that).
    const topY = fp.max[1];
    if (topY > maxSupportTop) maxSupportTop = topY;
  }

  if (maxSupportTop === -Infinity) {
    // No supporting object found — placement rejected
    return null;
  }

  return [px, maxSupportTop, pz];
}
