/**
 * Collider scanner — derives collider geometry for a kind by SCANNING
 * its actual GLB mesh, instead of hand-authoring an idealized spec.
 *
 * Two outputs (both normalized 0..1 against the mesh's local AABB, so
 * runtime consumers can map them through the per-instance `worldAABB`
 * they already have — independent of voxel size / mesh-origin / scale
 * conventions):
 *
 *   - `scanColliderCuboids`: voxel-stepped solid columns from an XZ
 *     heightfield — for stairs and stair-like solids. A handful of
 *     boxes is cheaper for the kinematic character controller than a
 *     triangle soup, plays well with autostep, and avoids trimesh
 *     internal-edge snags. Limitation: heightfield columns are solid
 *     from the base, so overhangs fill in (same as today's AABBs).
 *
 *   - `extractLocalTriangles`: the raw welded triangle soup — the
 *     basis for trimesh colliders (slopes), where one small mesh
 *     beats a stack of thin step boxes and gives smooth ascent.
 *
 * CONTRACT (same as layout-bake-service): zero imports from `three`,
 * `react`, or any DOM API. Pure: same Document in → same output.
 * Works under Node and in the browser.
 */

import type { Document, Node as GltfNode } from '@gltf-transform/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Axis-aligned box in normalized (0..1) mesh-AABB space. */
export interface NormalizedCuboid {
  min: [number, number, number];
  max: [number, number, number];
}

export interface LocalTriangles {
  /** Flat xyz vertex positions in the mesh's LOCAL space (node
   * transforms applied). */
  positions: Float32Array;
  /** Triangle indices into `positions` (3 per triangle). */
  indices: Uint32Array;
}

export interface ScanCuboidsOptions {
  /** XZ heightfield cell size in mesh units (metres). Default 0.125 —
   * half the 0.25 m stair run, so step edges land on cell borders. */
  cellSize?: number;
  /** Heights within this distance are clustered together (merging
   * solver noise / bevel shavings into one step level). */
  heightEpsilon?: number;
  /** Hard cap on emitted cuboids. Exceeding it throws — coarsen
   * `cellSize` rather than silently truncating coverage. */
  maxCuboids?: number;
}

export interface ScanCuboidsResult {
  /** Solid columns, normalized 0..1 to `aabb`. Deterministically
   * ordered (z, then x) so catalog diffs are stable. */
  cuboids: NormalizedCuboid[];
  /** The scanned mesh's local AABB (mesh units). */
  aabb: { min: [number, number, number]; max: [number, number, number] };
  /** Total triangles scanned (for the CLI's review table). */
  triangleCount: number;
}

// ---------------------------------------------------------------------------
// Triangle extraction
// ---------------------------------------------------------------------------

/** Multiply a column-major affine mat4 by a point (w=1). glTF node
 * matrices are TRS-affine, so no perspective divide is needed. */
function transformPoint(
  m: readonly number[],
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

const GL_TRIANGLES = 4;

/**
 * Gather every TRIANGLES primitive in the document's scenes into one
 * local-space triangle soup, applying each node's accumulated world
 * transform (gltf-transform's `getWorldMatrix` walks the parent
 * chain). Non-triangle primitives (lines, points) are skipped.
 */
export function extractLocalTriangles(doc: Document): LocalTriangles {
  const positions: number[] = [];
  const indices: number[] = [];

  for (const scene of doc.getRoot().listScenes()) {
    scene.traverse((node: GltfNode) => {
      const mesh = node.getMesh();
      if (!mesh) return;
      const world = node.getWorldMatrix();
      for (const prim of mesh.listPrimitives()) {
        const mode = prim.getMode();
        if (mode !== GL_TRIANGLES) continue;
        const pos = prim.getAttribute('POSITION');
        if (!pos) continue;
        const arr = pos.getArray();
        if (!arr) continue;
        const base = positions.length / 3;
        const count = pos.getCount();
        for (let i = 0; i < count; i++) {
          const [x, y, z] = transformPoint(
            world,
            arr[i * 3],
            arr[i * 3 + 1],
            arr[i * 3 + 2],
          );
          positions.push(x, y, z);
        }
        const idx = prim.getIndices();
        if (idx) {
          const ia = idx.getArray();
          if (!ia) continue;
          for (let i = 0; i < ia.length; i++) indices.push(base + ia[i]);
        } else {
          for (let i = 0; i < count; i++) indices.push(base + i);
        }
      }
    });
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}

// ---------------------------------------------------------------------------
// Heightfield cuboid scan
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Trimesh scan (slopes)
// ---------------------------------------------------------------------------

export interface ScanTrimeshResult {
  /** Flat xyz vertex positions normalized 0..1 to `aabb`. */
  positions: number[];
  /** Triangle indices into `positions`. */
  indices: number[];
  /** The scanned mesh's local AABB (mesh units). */
  aabb: { min: [number, number, number]; max: [number, number, number] };
  triangleCount: number;
}

/**
 * Scan a kind's mesh into a normalized trimesh collider: the welded,
 * degenerate-filtered triangle soup of the model itself. For slope
 * kinds the visual mesh IS the right collider — one small trimesh
 * gives smooth ascent under the KCC's slope handling where stepped
 * boxes would stutter.
 */
export function scanColliderTrimesh(doc: Document): ScanTrimeshResult {
  const { positions, indices } = extractLocalTriangles(doc);
  if (indices.length === 0) {
    throw new Error('scanColliderTrimesh: document contains no triangles.');
  }

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);     maxX = Math.max(maxX, positions[i]);
    minY = Math.min(minY, positions[i + 1]); maxY = Math.max(maxY, positions[i + 1]);
    minZ = Math.min(minZ, positions[i + 2]); maxZ = Math.max(maxZ, positions[i + 2]);
  }
  const sx = maxX - minX || 1;
  const sy = maxY - minY || 1;
  const sz = maxZ - minZ || 1;

  // Weld vertices on a fine grid (0.1 mm in normalized space ≈ sub-mm
  // for room-scale kinds) so coplanar source meshes share vertices and
  // the KCC sees a watertight surface instead of seam cracks.
  const WELD = 1e-4;
  const keyOf = (x: number, y: number, z: number) =>
    `${Math.round(x / WELD)}:${Math.round(y / WELD)}:${Math.round(z / WELD)}`;
  const vertexIndex = new Map<string, number>();
  const outPositions: number[] = [];
  const remap = new Uint32Array(positions.length / 3);
  for (let v = 0; v < positions.length / 3; v++) {
    const nx = (positions[v * 3] - minX) / sx;
    const ny = (positions[v * 3 + 1] - minY) / sy;
    const nz = (positions[v * 3 + 2] - minZ) / sz;
    const key = keyOf(nx, ny, nz);
    let idx = vertexIndex.get(key);
    if (idx === undefined) {
      idx = outPositions.length / 3;
      vertexIndex.set(key, idx);
      outPositions.push(nx, ny, nz);
    }
    remap[v] = idx;
  }

  const outIndices: number[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    const a = remap[indices[t]];
    const b = remap[indices[t + 1]];
    const c = remap[indices[t + 2]];
    if (a === b || b === c || a === c) continue; // degenerate after weld
    outIndices.push(a, b, c);
  }
  if (outIndices.length === 0) {
    throw new Error('scanColliderTrimesh: all triangles degenerate after welding.');
  }

  return {
    positions: outPositions,
    indices: outIndices,
    aabb: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
    triangleCount: outIndices.length / 3,
  };
}

/** Largest grid dimension the scanner will allocate. A 4 m kind at the
 * 0.125 m default is 32 cells/axis; 512 guards absurd cellSize input. */
const MAX_GRID_CELLS_PER_AXIS = 512;

export function scanColliderCuboids(
  doc: Document,
  options?: ScanCuboidsOptions,
): ScanCuboidsResult {
  const cellSize = options?.cellSize ?? 0.125;
  const heightEpsilon = options?.heightEpsilon ?? 0.01;
  const maxCuboids = options?.maxCuboids ?? 256;

  const { positions, indices } = extractLocalTriangles(doc);
  const triangleCount = indices.length / 3;
  if (triangleCount === 0) {
    throw new Error('scanColliderCuboids: document contains no triangles.');
  }

  // Mesh AABB.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);     maxX = Math.max(maxX, positions[i]);
    minY = Math.min(minY, positions[i + 1]); maxY = Math.max(maxY, positions[i + 1]);
    minZ = Math.min(minZ, positions[i + 2]); maxZ = Math.max(maxZ, positions[i + 2]);
  }
  const sizeX = maxX - minX;
  const sizeY = maxY - minY;
  const sizeZ = maxZ - minZ;
  if (sizeX <= 0 || sizeY <= 0 || sizeZ <= 0) {
    throw new Error('scanColliderCuboids: degenerate mesh AABB.');
  }

  const nx = Math.min(MAX_GRID_CELLS_PER_AXIS, Math.max(1, Math.round(sizeX / cellSize)));
  const nz = Math.min(MAX_GRID_CELLS_PER_AXIS, Math.max(1, Math.round(sizeZ / cellSize)));
  const cellX = sizeX / nx;
  const cellZ = sizeZ / nz;

  // Heightfield: max mesh Y per cell, sampled at 2×2 interior points
  // per cell. Sampling ONLY at interior points (never at cell borders)
  // is load-bearing: step edges in real models land exactly on cell
  // boundaries, and a boundary vertex would contaminate the LOWER
  // step's cell with the upper step's height, splitting clean steps
  // into shavings. The cost: features thinner than ~half a cell in
  // both X and Z are missed entirely — pick a cellSize finer than the
  // smallest feature you care about.
  const heights = new Float64Array(nx * nz).fill(Number.NEGATIVE_INFINITY);

  const raise = (cx: number, cz: number, y: number) => {
    if (cx < 0 || cx >= nx || cz < 0 || cz >= nz) return;
    const i = cz * nx + cx;
    if (y > heights[i]) heights[i] = y;
  };

  // Triangle-interior contributions via barycentric sampling.
  // Vertical triangles (≈zero XZ area) are skipped — walls don't
  // define standing height.
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
    const bx = positions[b], by = positions[b + 1], bz = positions[b + 2];
    const cx = positions[c], cy = positions[c + 1], cz = positions[c + 2];

    const det = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
    if (Math.abs(det) < 1e-10) continue; // vertical / degenerate in XZ

    const tMinX = Math.max(0, Math.floor((Math.min(ax, bx, cx) - minX) / cellX));
    const tMaxX = Math.min(nx - 1, Math.floor((Math.max(ax, bx, cx) - minX) / cellX));
    const tMinZ = Math.max(0, Math.floor((Math.min(az, bz, cz) - minZ) / cellZ));
    const tMaxZ = Math.min(nz - 1, Math.floor((Math.max(az, bz, cz) - minZ) / cellZ));

    for (let gz = tMinZ; gz <= tMaxZ; gz++) {
      for (let gx = tMinX; gx <= tMaxX; gx++) {
        for (const fx of [0.25, 0.75]) {
          for (const fz of [0.25, 0.75]) {
            const px = minX + (gx + fx) * cellX;
            const pz = minZ + (gz + fz) * cellZ;
            // Barycentric coordinates in the XZ projection.
            const w1 = ((bx - px) * (cz - pz) - (bz - pz) * (cx - px)) / det;
            const w2 = ((cx - px) * (az - pz) - (cz - pz) * (ax - px)) / det;
            const w3 = 1 - w1 - w2;
            if (w1 < -1e-9 || w2 < -1e-9 || w3 < -1e-9) continue;
            raise(gx, gz, w1 * ay + w2 * by + w3 * cy);
          }
        }
      }
    }
  }

  // Quantize heights to `heightEpsilon` levels above the base, and
  // drop floor-level shavings (cells whose only geometry is the
  // bottom face — a solid model's top surface always sits above the
  // base by at least one epsilon).
  const levels = new Int32Array(nx * nz).fill(-1); // -1 = empty
  for (let i = 0; i < heights.length; i++) {
    if (!Number.isFinite(heights[i])) continue;
    const lvl = Math.round((heights[i] - minY) / heightEpsilon);
    if (lvl <= 0) continue;
    levels[i] = lvl;
  }

  // Greedy rectangle merge over equal-level cells (classic greedy
  // meshing): grow a run along X, then extend the whole run in Z.
  const visited = new Uint8Array(nx * nz);
  const cuboids: NormalizedCuboid[] = [];
  for (let gz = 0; gz < nz; gz++) {
    for (let gx = 0; gx < nx; gx++) {
      const i = gz * nx + gx;
      if (visited[i] || levels[i] < 0) continue;
      const lvl = levels[i];

      let endX = gx;
      while (
        endX + 1 < nx &&
        !visited[gz * nx + endX + 1] &&
        levels[gz * nx + endX + 1] === lvl
      ) {
        endX++;
      }

      let endZ = gz;
      outer: while (endZ + 1 < nz) {
        for (let x = gx; x <= endX; x++) {
          const j = (endZ + 1) * nx + x;
          if (visited[j] || levels[j] !== lvl) break outer;
        }
        endZ++;
      }

      for (let z = gz; z <= endZ; z++) {
        for (let x = gx; x <= endX; x++) visited[z * nx + x] = 1;
      }

      const top = Math.min(sizeY, lvl * heightEpsilon);
      cuboids.push({
        min: [(gx * cellX) / sizeX, 0, (gz * cellZ) / sizeZ],
        max: [
          Math.min(1, ((endX + 1) * cellX) / sizeX),
          top / sizeY,
          Math.min(1, ((endZ + 1) * cellZ) / sizeZ),
        ],
      });
    }
  }

  if (cuboids.length > maxCuboids) {
    throw new Error(
      `scanColliderCuboids: ${cuboids.length} cuboids exceeds the cap of ` +
        `${maxCuboids}. Coarsen cellSize/heightEpsilon instead of shipping ` +
        `an unreviewably dense collider.`,
    );
  }

  return {
    cuboids,
    aabb: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
    triangleCount,
  };
}
