import type { ColliderDescriptor } from '../physics/rules.ts';

/**
 * A 2.5D walkability grid over the XZ plane. Cell `(i, j)` covers
 * `origin + [i, i+1) × cellSize` in x and `origin + [j, j+1) × cellSize`
 * in z and lives at index `j * width + i`.
 */
export interface NavGrid {
  origin: { x: number; z: number };
  cellSize: number;
  /** Cells along x. */
  width: number;
  /** Cells along z. */
  height: number;
  /** The largest rise between neighbouring cells a character can walk. */
  maxStep: number;
  /**
   * 1 where a character can stand. A wide obstacle's top can keep a
   * walkable island no stairs lead to; `findPath` never reaches it
   * because it only snaps to cells near the point's own height.
   */
  walkable: Uint8Array;
  /**
   * Standing height per cell; NaN where nothing is underfoot or no top
   * has head-room (an overhang, a solid column).
   */
  surface: Float32Array;
}

export interface NavGridOptions {
  cellSize?: number;
  charRadius: number;
  charHeight: number;
  maxStep: number;
}

const MARGIN_CELLS = 2;
const EPS = 1e-4;
/** 500 m square at the default cell size; a stray far-away collider would otherwise cost gigabytes. */
const MAX_CELLS = 4_000_000;

/** Null, with a warning, when the colliders span more than `MAX_CELLS` cells. */
export function buildNavGrid(colliders: readonly ColliderDescriptor[], opts: NavGridOptions): NavGrid | null {
  const cellSize = opts.cellSize ?? 0.25;
  const bounds = xzBounds(colliders);
  const origin = {
    x: (Math.floor(bounds.minX / cellSize) - MARGIN_CELLS) * cellSize,
    z: (Math.floor(bounds.minZ / cellSize) - MARGIN_CELLS) * cellSize,
  };
  const width = Math.ceil((bounds.maxX - origin.x) / cellSize) + MARGIN_CELLS;
  const height = Math.ceil((bounds.maxZ - origin.z) / cellSize) + MARGIN_CELLS;
  if (width * height > MAX_CELLS) {
    console.warn(`nav grid: colliders span ${width}×${height} cells, over the ${MAX_CELLS} limit; navigation is off`);
    return null;
  }
  const grid: NavGrid = {
    origin,
    cellSize,
    width,
    height,
    maxStep: opts.maxStep,
    walkable: new Uint8Array(width * height),
    surface: new Float32Array(width * height).fill(NaN),
  };

  const columns = solidColumns(grid, colliders);
  for (let c = 0; c < columns.length; c++) {
    const spans = columns[c];
    if (spans) {
      grid.surface[c] = lowestClearTop(spans, opts.charHeight);
    }
  }

  const blocked = obstructions(grid, colliders, opts.charHeight);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const c = j * width + i;
      if (Number.isNaN(grid.surface[c]) || isLedge(grid, i, j)) {
        blocked[c] = 1;
      }
    }
  }
  inflate(grid, blocked, opts.charRadius);
  return grid;
}

export function cellCentre(grid: NavGrid, i: number, j: number): { x: number; z: number } {
  return {
    x: grid.origin.x + (i + 0.5) * grid.cellSize,
    z: grid.origin.z + (j + 0.5) * grid.cellSize,
  };
}

function xzBounds(colliders: readonly ColliderDescriptor[]) {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  const add = (x: number, z: number) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  };
  for (const c of colliders) {
    if (c.type === 'cuboid') {
      add(c.center.x - c.halfExtents.x, c.center.z - c.halfExtents.z);
      add(c.center.x + c.halfExtents.x, c.center.z + c.halfExtents.z);
    } else {
      for (let v = 0; v < c.vertices.length; v += 3) {
        add(c.vertices[v], c.vertices[v + 2]);
      }
    }
  }
  return minX <= maxX ? { minX, minZ, maxX, maxZ } : { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };
}

/** Inclusive range of cell indices whose centres lie in `[lo, hi]` along one axis. */
function cellRange(lo: number, hi: number, origin: number, cellSize: number, count: number): [number, number] {
  return [
    Math.max(0, Math.ceil((lo - origin) / cellSize - 0.5 - EPS)),
    Math.min(count - 1, Math.floor((hi - origin) / cellSize - 0.5 + EPS)),
  ];
}

/** Inclusive range of cell indices whose span overlaps `(lo, hi)` along one axis. */
function overlapRange(lo: number, hi: number, origin: number, cellSize: number, count: number): [number, number] {
  return [
    Math.max(0, Math.floor((lo - origin) / cellSize + EPS)),
    Math.min(count - 1, Math.ceil((hi - origin) / cellSize - EPS) - 1),
  ];
}

/** Per cell, the `[bottom, top, bottom, top, …]` spans of solid each collider fills above the cell centre. */
function solidColumns(grid: NavGrid, colliders: readonly ColliderDescriptor[]): (number[] | undefined)[] {
  const columns: (number[] | undefined)[] = new Array(grid.width * grid.height);
  const addSpan = (c: number, bottom: number, top: number) => {
    (columns[c] ??= []).push(bottom, top);
  };
  for (const col of colliders) {
    if (col.type === 'cuboid') {
      const { center: m, halfExtents: h } = col;
      const [i0, i1] = cellRange(m.x - h.x, m.x + h.x, grid.origin.x, grid.cellSize, grid.width);
      const [j0, j1] = cellRange(m.z - h.z, m.z + h.z, grid.origin.z, grid.cellSize, grid.height);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          addSpan(j * grid.width + i, m.y - h.y, m.y + h.y);
        }
      }
    } else {
      for (const [c, span] of trimeshSpans(grid, col.vertices, col.indices)) {
        addSpan(c, span[0], span[1]);
      }
    }
  }
  return columns;
}

/** Treats a trimesh as solid between the lowest and highest of its triangles over each cell centre. */
function trimeshSpans(grid: NavGrid, v: readonly number[], indices: readonly number[]): Map<number, [number, number]> {
  const spans = new Map<number, [number, number]>();
  for (const tri of triangles(v, indices)) {
    const [i0, i1] = cellRange(tri.minX, tri.maxX, grid.origin.x, grid.cellSize, grid.width);
    const [j0, j1] = cellRange(tri.minZ, tri.maxZ, grid.origin.z, grid.cellSize, grid.height);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const p = cellCentre(grid, i, j);
        const y = tri.heightInside(p.x, p.z);
        if (Number.isNaN(y)) {
          continue;
        }
        const cell = j * grid.width + i;
        const span = spans.get(cell);
        if (span) {
          span[0] = Math.min(span[0], y);
          span[1] = Math.max(span[1], y);
        } else {
          spans.set(cell, [y, y]);
        }
      }
    }
  }
  return spans;
}

interface Triangle {
  minX: number;
  maxX: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  /** The triangle's plane height at `(x, z)`, extrapolated past its edges. */
  planeHeight(x: number, z: number): number;
  /** The triangle's height at `(x, z)`, or NaN outside it. */
  heightInside(x: number, z: number): number;
}

/** A trimesh's triangles that aren't vertical (a vertical one has no height over any point). */
function* triangles(v: readonly number[], indices: readonly number[]): Generator<Triangle> {
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3;
    const b = indices[t + 1] * 3;
    const c = indices[t + 2] * 3;
    const ax = v[a], ay = v[a + 1], az = v[a + 2];
    const bx = v[b], by = v[b + 1], bz = v[b + 2];
    const cx = v[c], cy = v[c + 1], cz = v[c + 2];
    const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(det) < EPS) {
      continue;
    }
    const weightA = (x: number, z: number) => ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det;
    const weightB = (x: number, z: number) => ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
    yield {
      minX: Math.min(ax, bx, cx),
      maxX: Math.max(ax, bx, cx),
      maxY: Math.max(ay, by, cy),
      minZ: Math.min(az, bz, cz),
      maxZ: Math.max(az, bz, cz),
      planeHeight(x, z) {
        const wa = weightA(x, z);
        const wb = weightB(x, z);
        return wa * ay + wb * by + (1 - wa - wb) * cy;
      },
      heightInside(x, z) {
        const wa = weightA(x, z);
        const wb = weightB(x, z);
        return wa < -EPS || wb < -EPS || 1 - wa - wb < -EPS ? NaN : this.planeHeight(x, z);
      },
    };
  }
}

/**
 * Blocks every cell a collider rises out of more than a step above its
 * surface, within head height, anywhere over the cell's square rather
 * than only over its centre: a wall thinner than a cell can miss every
 * centre.
 */
function obstructions(grid: NavGrid, colliders: readonly ColliderDescriptor[], charHeight: number): Uint8Array {
  const { width, cellSize, origin } = grid;
  const blocked = new Uint8Array(width * grid.height);
  const obstruct = (c: number, bottom: number, top: number) => {
    const s = grid.surface[c];
    if (top > s + grid.maxStep && bottom < s + charHeight) {
      blocked[c] = 1;
    }
  };
  for (const col of colliders) {
    if (col.type === 'cuboid') {
      const { center: m, halfExtents: h } = col;
      const [i0, i1] = overlapRange(m.x - h.x, m.x + h.x, origin.x, cellSize, width);
      const [j0, j1] = overlapRange(m.z - h.z, m.z + h.z, origin.z, cellSize, grid.height);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          obstruct(j * width + i, m.y - h.y, m.y + h.y);
        }
      }
      continue;
    }
    // ponytail: a trimesh counts as solid from its lowest vertex up; fine for slopes standing on a floor.
    let bottom = Infinity;
    for (let k = 1; k < col.vertices.length; k += 3) {
      bottom = Math.min(bottom, col.vertices[k]);
    }
    for (const tri of triangles(col.vertices, col.indices)) {
      const [i0, i1] = overlapRange(tri.minX, tri.maxX, origin.x, cellSize, width);
      const [j0, j1] = overlapRange(tri.minZ, tri.maxZ, origin.z, cellSize, grid.height);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = origin.x + i * cellSize;
          const z = origin.z + j * cellSize;
          // A plane peaks at a corner of the square; the clamp undoes extrapolating past the triangle.
          const top = Math.min(
            tri.maxY,
            Math.max(
              tri.planeHeight(x, z),
              tri.planeHeight(x + cellSize, z),
              tri.planeHeight(x, z + cellSize),
              tri.planeHeight(x + cellSize, z + cellSize),
            ),
          );
          obstruct(j * width + i, bottom, top);
        }
      }
    }
  }
  return blocked;
}

/**
 * The lowest top with a character's height of clear space above it.
 * Taking the lowest keeps the floor under a doorway's lintel, rather
 * than the lintel's top, as the surface.
 */
// ponytail: one surface per cell assumes a single storey; a walkable floor above another walkable floor is not modelled.
function lowestClearTop(spans: readonly number[], charHeight: number): number {
  let best = NaN;
  for (let s = 1; s < spans.length; s += 2) {
    const top = spans[s];
    if (top >= best) {
      continue;
    }
    let clear = true;
    for (let o = 0; o < spans.length && clear; o += 2) {
      clear = !(spans[o + 1] > top + EPS && spans[o] < top + charHeight - EPS);
    }
    if (clear) {
      best = top;
    }
  }
  return best;
}

/** A cell more than a step above a neighbour: a wall top, table top or platform edge. */
function isLedge(grid: NavGrid, i: number, j: number): boolean {
  const s = grid.surface[j * grid.width + i];
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= grid.width || nj >= grid.height) {
        continue;
      }
      if (s - grid.surface[nj * grid.width + ni] > grid.maxStep) {
        return true;
      }
    }
  }
  return false;
}

function inflate(grid: NavGrid, blocked: Uint8Array, radius: number): void {
  const { width, height } = grid;
  const reach = Math.floor(radius / grid.cellSize);
  const offsets: [number, number][] = [];
  for (let dj = -reach; dj <= reach; dj++) {
    for (let di = -reach; di <= reach; di++) {
      if (Math.hypot(di, dj) * grid.cellSize <= radius + EPS) {
        offsets.push([di, dj]);
      }
    }
  }
  for (let c = 0; c < blocked.length; c++) {
    grid.walkable[c] = 1 - blocked[c];
  }
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      if (blocked[j * width + i] === 0) {
        continue;
      }
      for (const [di, dj] of offsets) {
        const ni = i + di;
        const nj = j + dj;
        if (ni >= 0 && nj >= 0 && ni < width && nj < height) {
          grid.walkable[nj * width + ni] = 0;
        }
      }
    }
  }
}
