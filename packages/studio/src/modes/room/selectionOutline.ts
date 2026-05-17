/**
 * Pure helper: turn a set of selected objects (each with a voxel
 * position + its kind's world-space dimensions) into the flat edge
 * list of their outline.
 *
 * Algorithm:
 *   - Each object contributes its 12 axis-aligned bounding-box edges
 *     in world space (`pos * voxelSize` → `pos * voxelSize + dims`).
 *   - Coincident edges between two adjacent objects collapse via
 *     symbolic endpoint dedup, so two flush 2 m cubes outline as the
 *     combined silhouette (the shared 4-edge rim of the touching face
 *     becomes a single rim, not two).
 *
 * Replaces the prior voxel-grid silhouette algorithm, which assumed
 * "1 voxel = 1 object." After the per-kind dimensions refactor each
 * placeObject is a single instance at one voxel position with its own
 * world-space size, so the outline must size each box from the kind's
 * `dimensions` field.
 *
 * Output is a flat number[] of (x, y, z) coords arranged in pairs:
 * `[ax, ay, az, bx, by, bz, ...]` — exactly what
 * `BufferAttribute(positions, 3)` + `<lineSegments>` consumes.
 *
 * Coords are in WORLD space, scaled by `voxelSize`.
 */

export type Vec3 = readonly [number, number, number];

export interface OutlineBox {
  /** Anchor voxel position (lower corner). */
  position: Vec3;
  /** Bounding-box extents in metres. */
  dims: { width: number; height: number; depth: number };
}

/**
 * Compute the flat `positions` array for `<lineSegments>` that
 * outlines the union of `boxes`. Each pair of consecutive (x, y, z)
 * triples forms one line segment. Deduplicates edges shared by two
 * adjacent boxes that have an axis-aligned coincident face rim.
 */
export function outlineEdgePositions(
  boxes: ReadonlyArray<OutlineBox>,
  voxelSize: number,
): Float32Array {
  if (boxes.length === 0) return new Float32Array(0);

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

  for (const box of boxes) {
    const [vx, vy, vz] = box.position;
    const x0 = vx * voxelSize;
    const y0 = vy * voxelSize;
    const z0 = vz * voxelSize;
    const x1 = x0 + box.dims.width;
    const y1 = y0 + box.dims.height;
    const z1 = z0 + box.dims.depth;

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
