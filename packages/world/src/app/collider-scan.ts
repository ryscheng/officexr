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
 *   - `scanColliderProfile`: the silhouette seen along one axis,
 *     extruded through the kind — for walls with doorways/windows and
 *     floors with holes, where the heightfield would fill the opening.
 *
 * CONTRACT (same as layout-bake-service): zero imports from `three`,
 * `react`, or any DOM API. Pure: same Document in → same output.
 * Works under Node and in the browser.
 */

import type { Document, Node as GltfNode } from '@gltf-transform/core';
import { SCANNED_CUBOIDS_MAX } from '../scenes/world-object-kinds-schema.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Axis-aligned box in mesh units. */
export type Aabb = { min: [number, number, number]; max: [number, number, number] };

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
  aabb: Aabb;
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

function meshAabb(positions: Float32Array): Aabb {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], positions[i + a]);
      max[a] = Math.max(max[a], positions[i + a]);
    }
  }
  return { min, max };
}

// ---------------------------------------------------------------------------
// Trimesh scan (slopes)
// ---------------------------------------------------------------------------

export interface ScanTrimeshResult {
  /** Flat xyz vertex positions normalized 0..1 to `aabb`. */
  positions: number[];
  /** Triangle indices into `positions`. */
  indices: number[];
  /** The scanned mesh's local AABB (mesh units). */
  aabb: Aabb;
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

  const aabb = meshAabb(positions);
  const [minX, minY, minZ] = aabb.min;
  const [maxX, maxY, maxZ] = aabb.max;
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
    aabb,
    triangleCount: outIndices.length / 3,
  };
}

/** Largest grid dimension the scanner will allocate. A 4 m kind at the
 * 0.125 m default is 32 cells/axis; 512 guards absurd cellSize input. */
const MAX_GRID_CELLS_PER_AXIS = 512;

function gridCells(size: number, cellSize: number): number {
  return Math.min(MAX_GRID_CELLS_PER_AXIS, Math.max(1, Math.round(size / cellSize)));
}

/** A merged run of equal-label cells; `u1`/`v1` are exclusive. */
interface CellRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  label: number;
}

/**
 * Greedy rectangle merge (classic greedy meshing) over a `nu × nv` grid
 * of labels, row-major in `u`; labels ≤ 0 are empty. Grows a run along
 * `u`, then extends the whole run along `v` while the next row matches.
 * Deterministic: rects come out ordered by (v0, u0).
 */
function mergeRects(labels: Int32Array, nu: number, nv: number): CellRect[] {
  const visited = new Uint8Array(nu * nv);
  const rects: CellRect[] = [];
  for (let v = 0; v < nv; v++) {
    for (let u = 0; u < nu; u++) {
      const i = v * nu + u;
      if (visited[i] || labels[i] <= 0) {
        continue;
      }
      const label = labels[i];

      let endU = u;
      while (endU + 1 < nu && !visited[v * nu + endU + 1] && labels[v * nu + endU + 1] === label) {
        endU++;
      }

      let endV = v;
      outer: while (endV + 1 < nv) {
        for (let x = u; x <= endU; x++) {
          const j = (endV + 1) * nu + x;
          if (visited[j] || labels[j] !== label) {
            break outer;
          }
        }
        endV++;
      }

      for (let y = v; y <= endV; y++) {
        for (let x = u; x <= endU; x++) {
          visited[y * nu + x] = 1;
        }
      }
      rects.push({ u0: u, v0: v, u1: endU + 1, v1: endV + 1, label });
    }
  }
  return rects;
}

export function scanColliderCuboids(
  doc: Document,
  options?: ScanCuboidsOptions,
): ScanCuboidsResult {
  const cellSize = options?.cellSize ?? 0.125;
  const heightEpsilon = options?.heightEpsilon ?? 0.01;
  const maxCuboids = options?.maxCuboids ?? SCANNED_CUBOIDS_MAX;

  const { positions, indices } = extractLocalTriangles(doc);
  const triangleCount = indices.length / 3;
  if (triangleCount === 0) {
    throw new Error('scanColliderCuboids: document contains no triangles.');
  }

  const aabb = meshAabb(positions);
  const [minX, minY, minZ] = aabb.min;
  const [maxX, maxY, maxZ] = aabb.max;
  const sizeX = maxX - minX;
  const sizeY = maxY - minY;
  const sizeZ = maxZ - minZ;
  if (sizeX <= 0 || sizeY <= 0 || sizeZ <= 0) {
    throw new Error('scanColliderCuboids: degenerate mesh AABB.');
  }

  const nx = gridCells(sizeX, cellSize);
  const nz = gridCells(sizeZ, cellSize);
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

  const cuboids: NormalizedCuboid[] = mergeRects(levels, nx, nz).map((r) => {
    const top = Math.min(sizeY, r.label * heightEpsilon);
    return {
      min: [(r.u0 * cellX) / sizeX, 0, (r.v0 * cellZ) / sizeZ],
      max: [Math.min(1, (r.u1 * cellX) / sizeX), top / sizeY, Math.min(1, (r.v1 * cellZ) / sizeZ)],
    };
  });

  if (cuboids.length > maxCuboids) {
    throw new Error(
      `scanColliderCuboids: ${cuboids.length} cuboids exceeds the cap of ` +
        `${maxCuboids}. Coarsen cellSize/heightEpsilon instead of shipping ` +
        `an unreviewably dense collider.`,
    );
  }

  return { cuboids, aabb, triangleCount };
}

// ---------------------------------------------------------------------------
// Profile scan (walls with openings, floors with holes)
// ---------------------------------------------------------------------------

export interface ScanProfileOptions {
  /** Extrusion axis — the kind's thin axis. Default 'z'. */
  axis?: 'x' | 'y' | 'z';
  /** Grid cell size in the projection plane (metres). Default 0.125. */
  cellSize?: number;
}

const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const;

/**
 * Scan a kind's silhouette along `axis` into cuboids that each span the
 * full local extent along `axis`, so openings through the kind (doorways,
 * windows, floor holes) stay open. Triangles are projected onto the
 * plane perpendicular to `axis`; a grid cell is solid when its centre
 * lies inside a projected triangle. Edge-on triangles (a jamb's inner
 * face) project to zero area and mark nothing. Throws when the merged
 * count exceeds `SCANNED_CUBOIDS_MAX`.
 */
export function scanColliderProfile(
  doc: Document,
  options?: ScanProfileOptions,
): ScanCuboidsResult {
  const axis = AXIS_INDEX[options?.axis ?? 'z'];
  const cellSize = options?.cellSize ?? 0.125;
  // Plane axes in ascending order: z → (x, y), y → (x, z), x → (y, z).
  const [ua, va] = [0, 1, 2].filter((a) => a !== axis);

  const { positions, indices } = extractLocalTriangles(doc);
  const triangleCount = indices.length / 3;
  if (triangleCount === 0) {
    throw new Error('scanColliderProfile: document contains no triangles.');
  }
  const aabb = meshAabb(positions);
  const size = aabb.max.map((m, a) => m - aabb.min[a]);
  if (size.some((s) => s <= 0)) {
    throw new Error('scanColliderProfile: degenerate mesh AABB.');
  }

  const nu = gridCells(size[ua], cellSize);
  const nv = gridCells(size[va], cellSize);
  const cellU = size[ua] / nu;
  const cellV = size[va] / nv;
  const solid = new Int32Array(nu * nv);
  // Index range of the cells whose centres lie within [lo, hi].
  const firstCell = (lo: number, origin: number, cell: number) =>
    Math.max(0, Math.ceil((lo - origin) / cell - 0.5));
  const lastCell = (hi: number, origin: number, cell: number, n: number) =>
    Math.min(n - 1, Math.floor((hi - origin) / cell - 0.5));

  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const au = positions[a + ua], av = positions[a + va];
    const bu = positions[b + ua], bv = positions[b + va];
    const cu = positions[c + ua], cv = positions[c + va];
    const det = (bu - au) * (cv - av) - (bv - av) * (cu - au);
    if (Math.abs(det) < 1e-10) {
      continue;
    }
    const u0 = firstCell(Math.min(au, bu, cu), aabb.min[ua], cellU);
    const u1 = lastCell(Math.max(au, bu, cu), aabb.min[ua], cellU, nu);
    const v0 = firstCell(Math.min(av, bv, cv), aabb.min[va], cellV);
    const v1 = lastCell(Math.max(av, bv, cv), aabb.min[va], cellV, nv);
    for (let gv = v0; gv <= v1; gv++) {
      const pv = aabb.min[va] + (gv + 0.5) * cellV;
      for (let gu = u0; gu <= u1; gu++) {
        const pu = aabb.min[ua] + (gu + 0.5) * cellU;
        const w1 = ((bu - pu) * (cv - pv) - (bv - pv) * (cu - pu)) / det;
        const w2 = ((cu - pu) * (av - pv) - (cv - pv) * (au - pu)) / det;
        if (w1 >= -1e-9 && w2 >= -1e-9 && 1 - w1 - w2 >= -1e-9) {
          solid[gv * nu + gu] = 1;
        }
      }
    }
  }

  const cuboids = mergeRects(solid, nu, nv).map((r): NormalizedCuboid => {
    const min: [number, number, number] = [0, 0, 0];
    const max: [number, number, number] = [1, 1, 1];
    min[ua] = r.u0 / nu;
    max[ua] = r.u1 / nu;
    min[va] = r.v0 / nv;
    max[va] = r.v1 / nv;
    return { min, max };
  });
  if (cuboids.length > SCANNED_CUBOIDS_MAX) {
    throw new Error(
      `scanColliderProfile: ${cuboids.length} cuboids exceeds the cap of ` +
        `${SCANNED_CUBOIDS_MAX}. Coarsen cellSize.`,
    );
  }
  return { cuboids, aabb, triangleCount };
}
