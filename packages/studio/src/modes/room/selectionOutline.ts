/**
 * Pure helper: turn a set of selected voxel positions into the edge
 * list of their outline. The outline is the boundary between
 * "selected" and "not selected" — for an L-shape the outline traces
 * the L silhouette rather than collapsing to the L's AABB.
 *
 * Algorithm:
 *   - Bucket the selection into a voxel set keyed by "x|y|z".
 *   - For each selected voxel, walk its 6 face directions. If the
 *     neighbour in that direction is NOT in the set, that face is
 *     EXTERIOR — emit its 4 edges.
 *   - Dedupe edges by canonical endpoint pair so adjacent exterior
 *     faces don't double-draw their shared rim (12 edges of an
 *     isolated cube vs. 24 if we didn't dedupe).
 *
 * Output is a flat number[] of (x, y, z) coords arranged in pairs:
 * `[ax, ay, az, bx, by, bz, ...]` — exactly what
 * `BufferAttribute(positions, 3)` + `<lineSegments>` consumes.
 *
 * Coords are in WORLD space, scaled by `cubeSize`. Edges sit on the
 * exact voxel boundary — adjacent cubes' shared edges land on
 * identical world coordinates and dedupe symbolically.
 */

export type Vec3 = readonly [number, number, number];

function vKey(x: number, y: number, z: number): string {
  return `${x}|${y}|${z}`;
}

// Six axis-aligned face directions. Each entry: the neighbour offset
// + the 4 face corners as half-extent multipliers (±1, ±1, ±1) in
// (x, y, z) where the y coordinate is RELATIVE to the cube's y-min
// (since cube y=0 sits at world y=0, not centred).
//
// For a cube at voxel (vx, vy, vz):
//   centre.x = vx * cubeSize
//   centre.z = vz * cubeSize
//   y-min   = vy * cubeSize       (the cube extends from y to y+cubeSize)
// Half extent for x/z is `cubeSize / 2`; y extent spans
// `[yMin, yMax] = [vy * cubeSize, (vy + 1) * cubeSize]` — exact
// voxel boundary, no inflation.
interface FaceDef {
  /** Neighbour voxel offset. */
  n: Vec3;
  /** 4 corners of the face. Each is (xSign, ySign, zSign) where:
   *   - xSign ∈ {-1, +1}: maps to centre.x ± halfX
   *   - ySign ∈ {0, 1}: maps to yMin or yMax
   *   - zSign ∈ {-1, +1}: maps to centre.z ± halfZ
   * Ordered so consecutive corners share an edge.
   */
  corners: [
    [number, number, number],
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ];
}

const FACES: ReadonlyArray<FaceDef> = [
  // +x face (right): the 4 corners share x = +halfX.
  {
    n: [1, 0, 0],
    corners: [
      [1, 0, -1],
      [1, 1, -1],
      [1, 1, 1],
      [1, 0, 1],
    ],
  },
  // -x face (left)
  {
    n: [-1, 0, 0],
    corners: [
      [-1, 0, -1],
      [-1, 1, -1],
      [-1, 1, 1],
      [-1, 0, 1],
    ],
  },
  // +y face (top): y = yMax
  {
    n: [0, 1, 0],
    corners: [
      [-1, 1, -1],
      [1, 1, -1],
      [1, 1, 1],
      [-1, 1, 1],
    ],
  },
  // -y face (bottom): y = yMin
  {
    n: [0, -1, 0],
    corners: [
      [-1, 0, -1],
      [1, 0, -1],
      [1, 0, 1],
      [-1, 0, 1],
    ],
  },
  // +z face (front)
  {
    n: [0, 0, 1],
    corners: [
      [-1, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [-1, 1, 1],
    ],
  },
  // -z face (back)
  {
    n: [0, 0, -1],
    corners: [
      [-1, 0, -1],
      [1, 0, -1],
      [1, 1, -1],
      [-1, 1, -1],
    ],
  },
];

/** Compute the flat `positions` array for `<lineSegments>` that
 * outlines the union of `voxels`. Each pair of consecutive
 * (x, y, z) triples forms one line segment. Deduplicates edges
 * shared by two adjacent exterior faces.
 *
 * Edges sit on the exact voxel boundary so that adjacent cubes'
 * face-perimeter edges land on identical world coordinates and
 * dedupe symbolically. The rendering side uses `depthTest: false`
 * so the lines stay visible even coplanar with the visible cube
 * surface.
 */
export function outlineEdgePositions(
  voxels: ReadonlyArray<Vec3>,
  cubeSize: number,
): Float32Array {
  if (voxels.length === 0) return new Float32Array(0);

  // Build set of selected voxel keys for O(1) neighbour lookups.
  const sel = new Set<string>();
  for (const v of voxels) sel.add(vKey(v[0], v[1], v[2]));

  const halfXZ = cubeSize / 2;

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

  for (const v of voxels) {
    const [vx, vy, vz] = v;
    const cx = vx * cubeSize;
    const cz = vz * cubeSize;
    const yMin = vy * cubeSize;
    const yMax = (vy + 1) * cubeSize;
    for (const f of FACES) {
      if (sel.has(vKey(vx + f.n[0], vy + f.n[1], vz + f.n[2]))) {
        // Shared with another selected voxel — not on the outline.
        continue;
      }
      const corners: Vec3[] = f.corners.map(([sx, sy, sz]) => [
        cx + sx * halfXZ,
        sy === 0 ? yMin : yMax,
        cz + sz * halfXZ,
      ]);
      for (let i = 0; i < 4; i++) {
        const a = corners[i];
        const b = corners[(i + 1) % 4];
        pushEdge(a[0], a[1], a[2], b[0], b[1], b[2]);
      }
    }
  }

  return new Float32Array(positions);
}
