/**
 * Pure helper: turn a set of selected objects' world-space AABBs into
 * the flat edge list of their outline.
 *
 * Algorithm:
 *   - Each AABB contributes its 12 axis-aligned bounding-box edges.
 *   - Coincident edges between two adjacent AABBs collapse via
 *     symbolic endpoint dedup, so two flush 2 m cubes outline as the
 *     combined silhouette (the shared 4-edge rim of the touching face
 *     becomes a single rim, not two).
 *
 * After the three-layer architecture refactor, this module is purely
 * an edge-list emitter — the caller provides AABBs already in world
 * space, derived from the canonical `InstanceGeometryService`. The
 * outline no longer interprets voxel positions or kind dimensions
 * itself; that lives behind one source of truth in `world/app`.
 *
 * Output is a flat number[] of (x, y, z) coords arranged in pairs:
 * `[ax, ay, az, bx, by, bz, ...]` — exactly what
 * `BufferAttribute(positions, 3)` + `<lineSegments>` consumes.
 */

export type Vec3 = readonly [number, number, number];

export interface WorldAABB {
  readonly min: Vec3;
  readonly max: Vec3;
}

/**
 * Compute the flat `positions` array for `<lineSegments>` that
 * outlines the union of `aabbs`. Each pair of consecutive (x, y, z)
 * triples forms one line segment. Deduplicates edges shared by two
 * adjacent AABBs that have an axis-aligned coincident face rim.
 */
export function outlineEdgePositions(
  aabbs: ReadonlyArray<WorldAABB>,
): Float32Array {
  if (aabbs.length === 0) return new Float32Array(0);

  const edges = new Set<string>();
  const positions: number[] = [];

  const pushEdge = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
  ) => {
    // Canonicalise so (A,B) and (B,A) collapse to the same key.
    const aFirst =
      ax < bx ||
      (ax === bx && (ay < by || (ay === by && az < bz)));
    const k = aFirst
      ? `${ax},${ay},${az}|${bx},${by},${bz}`
      : `${bx},${by},${bz}|${ax},${ay},${az}`;
    if (edges.has(k)) return;
    edges.add(k);
    positions.push(ax, ay, az, bx, by, bz);
  };

  for (const aabb of aabbs) {
    const [x0, y0, z0] = aabb.min;
    const [x1, y1, z1] = aabb.max;
    // 12 edges of an axis-aligned box. Numbered as the 8 corners:
    //   0: (x0, y0, z0)   1: (x1, y0, z0)
    //   2: (x1, y0, z1)   3: (x0, y0, z1)
    //   4: (x0, y1, z0)   5: (x1, y1, z0)
    //   6: (x1, y1, z1)   7: (x0, y1, z1)
    // Bottom rim:    0-1, 1-2, 2-3, 3-0
    // Top rim:       4-5, 5-6, 6-7, 7-4
    // Vertical sides:0-4, 1-5, 2-6, 3-7
    pushEdge(x0, y0, z0, x1, y0, z0);
    pushEdge(x1, y0, z0, x1, y0, z1);
    pushEdge(x1, y0, z1, x0, y0, z1);
    pushEdge(x0, y0, z1, x0, y0, z0);
    pushEdge(x0, y1, z0, x1, y1, z0);
    pushEdge(x1, y1, z0, x1, y1, z1);
    pushEdge(x1, y1, z1, x0, y1, z1);
    pushEdge(x0, y1, z1, x0, y1, z0);
    pushEdge(x0, y0, z0, x0, y1, z0);
    pushEdge(x1, y0, z0, x1, y1, z0);
    pushEdge(x1, y0, z1, x1, y1, z1);
    pushEdge(x0, y0, z1, x0, y1, z1);
  }

  return new Float32Array(positions);
}
