import { cellCentre, type NavGrid } from './grid.ts';
import { MinHeap } from './heap.ts';

const SNAP_RADIUS_M = 3;
// Parallel arrays rather than tuples: destructuring in the A* loop allocates and dominates its time.
// Orthogonal neighbours first, then diagonals.
const NEIGHBOUR_DI = [1, -1, 0, 0, 1, 1, -1, -1];
const NEIGHBOUR_DJ = [0, 0, 1, -1, 1, -1, 1, -1];

/**
 * Shortest walkable route between two world positions, as the XZ
 * centres of the cells to walk through (both ends included), or null
 * when either end has no walkable cell nearby at its height or the
 * ends are not connected.
 *
 * `y` is feet height, the surface the point stands on. A store position
 * (`players[id].pos`) is the body root, below the feet; convert it with
 * `feetPosition(pos, charRadius)`.
 */
export function findPath(
  grid: NavGrid,
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
): { x: number; z: number }[] | null {
  const start = snap(grid, from);
  const goal = snap(grid, to);
  if (start < 0 || goal < 0) {
    return null;
  }
  const cells = aStar(grid, start, goal);
  if (!cells) {
    return null;
  }
  return smooth(grid, cells).map((c) => cellCentre(grid, c % grid.width, Math.floor(c / grid.width)));
}

function canStep(grid: NavGrid, from: number, to: number): boolean {
  return grid.walkable[to] === 1 && Math.abs(grid.surface[from] - grid.surface[to]) <= grid.maxStep;
}

/** Nearest walkable cell at the point's height, so a point beside a table never lands on its top; -1 if none. */
function snap(grid: NavGrid, p: { x: number; y: number; z: number }): number {
  const reach = Math.ceil(SNAP_RADIUS_M / grid.cellSize);
  const ci = Math.floor((p.x - grid.origin.x) / grid.cellSize);
  const cj = Math.floor((p.z - grid.origin.z) / grid.cellSize);
  let best = -1;
  let bestDist = SNAP_RADIUS_M * SNAP_RADIUS_M;
  for (let j = Math.max(0, cj - reach); j <= Math.min(grid.height - 1, cj + reach); j++) {
    for (let i = Math.max(0, ci - reach); i <= Math.min(grid.width - 1, ci + reach); i++) {
      const c = j * grid.width + i;
      if (grid.walkable[c] !== 1 || Math.abs(grid.surface[c] - p.y) > grid.maxStep) {
        continue;
      }
      const centre = cellCentre(grid, i, j);
      const dist = (centre.x - p.x) ** 2 + (centre.z - p.z) ** 2;
      if (dist <= bestDist) {
        best = c;
        bestDist = dist;
      }
    }
  }
  return best;
}

function aStar(grid: NavGrid, start: number, goal: number): number[] | null {
  const { width, height } = grid;
  const gi = goal % width;
  const gj = Math.floor(goal / width);
  const octile = (c: number) => {
    const dx = Math.abs((c % width) - gi);
    const dz = Math.abs(Math.floor(c / width) - gj);
    return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
  };
  const cost = new Float64Array(width * height).fill(Infinity);
  const cameFrom = new Int32Array(width * height).fill(-1);
  const closed = new Uint8Array(width * height);
  const open = new MinHeap();
  cost[start] = 0;
  open.push(start, octile(start));
  while (open.size > 0) {
    const c = open.pop();
    if (c === goal) {
      const cells = [c];
      for (let p = cameFrom[c]; p >= 0; p = cameFrom[p]) {
        cells.push(p);
      }
      return cells.reverse();
    }
    if (closed[c]) {
      continue;
    }
    closed[c] = 1;
    const i = c % width;
    const j = Math.floor(c / width);
    for (let k = 0; k < 8; k++) {
      const ni = i + NEIGHBOUR_DI[k];
      const nj = j + NEIGHBOUR_DJ[k];
      const diagonal = k >= 4;
      if (ni < 0 || nj < 0 || ni >= width || nj >= height) {
        continue;
      }
      const n = nj * width + ni;
      if (closed[n] || !canStep(grid, c, n)) {
        continue;
      }
      if (diagonal && !(canStep(grid, c, j * width + ni) && canStep(grid, c, nj * width + i))) {
        continue;
      }
      const next = cost[c] + (diagonal ? Math.SQRT2 : 1);
      if (next < cost[n]) {
        cost[n] = next;
        cameFrom[n] = c;
        open.push(n, next + octile(n));
      }
    }
  }
  return null;
}

/** Drops every waypoint the previous kept one can see past. */
function smooth(grid: NavGrid, cells: number[]): number[] {
  if (cells.length <= 2) {
    return cells;
  }
  const kept = [cells[0]];
  for (let k = 2; k < cells.length; k++) {
    if (!lineOfSight(grid, kept[kept.length - 1], cells[k])) {
      kept.push(cells[k - 1]);
    }
  }
  kept.push(cells[cells.length - 1]);
  return kept;
}

/** Walks every cell the straight line between two cell centres crosses, by the same step rule as A*. */
function lineOfSight(grid: NavGrid, from: number, to: number): boolean {
  const { width } = grid;
  let i = from % width;
  let j = Math.floor(from / width);
  const ti = to % width;
  const tj = Math.floor(to / width);
  const dx = Math.abs(ti - i);
  const dz = Math.abs(tj - j);
  const sx = Math.sign(ti - i);
  const sz = Math.sign(tj - j);
  let ix = 0;
  let iz = 0;
  while (ix < dx || iz < dz) {
    const c = j * width + i;
    const decision = (1 + 2 * ix) * dz - (1 + 2 * iz) * dx;
    if (decision === 0) {
      // Through a corner: both cells beside it must be passable too.
      if (!canStep(grid, c, j * width + i + sx) || !canStep(grid, c, (j + sz) * width + i)) {
        return false;
      }
      i += sx;
      j += sz;
      ix++;
      iz++;
    } else if (decision < 0) {
      i += sx;
      ix++;
    } else {
      j += sz;
      iz++;
    }
    if (!canStep(grid, c, j * width + i)) {
      return false;
    }
  }
  return true;
}
