/**
 * Pure helper: group voxel positions into clusters of touching voxels.
 *
 * Two voxels "touch" when they share a face — i.e. their integer
 * positions differ by exactly 1 along exactly one axis (6-neighbour
 * adjacency). Diagonals don't count.
 *
 * Used by the Room editor's selection wireframe: rendering a single
 * AABB around all selected voxels reads as "everything in this box
 * is selected" — confusing when the user picked the two diagonal
 * corners of a 2×N grid. Clustering produces one wireframe per
 * connected component, so disjoint selections look disjoint and
 * adjacent ones still merge into a single hull.
 */

export type Vec3 = readonly [number, number, number];

function vKey(v: Vec3): string {
  return `${v[0]}|${v[1]}|${v[2]}`;
}

const NEIGHBOUR_OFFSETS: ReadonlyArray<Vec3> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/**
 * Group a list of voxel positions into clusters where each cluster
 * is a maximal face-connected component. Positions are deduped on
 * the way in so callers don't have to pre-clean them. The order of
 * clusters matches the order voxels were first seen in the input;
 * within each cluster the positions retain a stable order suitable
 * for AABB computation.
 */
export function clusterTouchingVoxels(
  positions: ReadonlyArray<Vec3>,
): Vec3[][] {
  // Build a key → position lookup. First-seen wins, so the seed
  // order is the input's first occurrence of each voxel.
  const byKey = new Map<string, Vec3>();
  for (const p of positions) {
    const k = vKey(p);
    if (!byKey.has(k)) byKey.set(k, [p[0], p[1], p[2]]);
  }

  const visited = new Set<string>();
  const clusters: Vec3[][] = [];

  for (const [seedKey, seedPos] of byKey) {
    if (visited.has(seedKey)) continue;
    // BFS from this seed, expanding through face-neighbours that are
    // also in the input set.
    const cluster: Vec3[] = [];
    const queue: Vec3[] = [seedPos];
    visited.add(seedKey);
    while (queue.length > 0) {
      const cur = queue.shift() as Vec3;
      cluster.push(cur);
      for (const off of NEIGHBOUR_OFFSETS) {
        const nb: Vec3 = [cur[0] + off[0], cur[1] + off[1], cur[2] + off[2]];
        const nbKey = vKey(nb);
        if (!byKey.has(nbKey) || visited.has(nbKey)) continue;
        visited.add(nbKey);
        // Use the canonicalised position from byKey so we don't add a
        // freshly-allocated tuple when an equivalent one already
        // exists.
        const canonical = byKey.get(nbKey) as Vec3;
        queue.push(canonical);
      }
    }
    clusters.push(cluster);
  }

  return clusters;
}
