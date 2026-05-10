import type { CubeKindId, WorldMap } from '../game-state/types.ts';
import type { BoundingCircle, CollisionGroup, Vec2 } from './types.ts';
import { EMPTY_CELL } from './types.ts';

interface BuildResult {
  cells: Int32Array;
  groups: CollisionGroup[];
}

/**
 * Iterative 4-neighbour flood fill on a cell grid. Each connected component
 * of non-walkable cells of the same {@link CubeKind} becomes one
 * {@link CollisionGroup}. The returned `cells` buffer maps each occupied
 * grid index to a groupId for O(1) lookup; walkable / empty cells are
 * {@link EMPTY_CELL}.
 *
 * The algorithm is deterministic — peers running the same map must produce
 * the same groupIds, so collision behaviour stays in sync without anyone
 * broadcasting the derived structure.
 */
export function groupConnectedCubes(map: WorldMap): BuildResult {
  const { gridSize, cubeSize, origin } = map;
  const cells = new Int32Array(gridSize * gridSize).fill(EMPTY_CELL);
  // kindOf[idx] is the kindId at that cell, or '' if empty/walkable. We
  // populate it once per layer so flood-fill can compare neighbour kinds in
  // O(1) without re-traversing the layer arrays.
  const kindOf = new Array<string>(gridSize * gridSize).fill('');
  for (const layer of map.layers) {
    const kind = map.kinds[layer.kind];
    if (!kind || kind.walkable) continue;
    for (const c of layer.cells) {
      if (c.i < 0 || c.i >= gridSize || c.j < 0 || c.j >= gridSize) continue;
      kindOf[c.i * gridSize + c.j] = layer.kind;
    }
  }

  const groups: CollisionGroup[] = [];
  const stack: number[] = [];
  for (let idx = 0; idx < kindOf.length; idx++) {
    if (cells[idx] !== EMPTY_CELL) continue;
    const kindId = kindOf[idx];
    if (!kindId) continue;
    const groupId = groups.length;
    const groupCells: Array<{ i: number; j: number }> = [];
    stack.push(idx);
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (cells[cur] !== EMPTY_CELL) continue;
      if (kindOf[cur] !== kindId) continue;
      cells[cur] = groupId;
      const i = Math.floor(cur / gridSize);
      const j = cur % gridSize;
      groupCells.push({ i, j });
      // 4 neighbours
      if (i > 0) stack.push((i - 1) * gridSize + j);
      if (i + 1 < gridSize) stack.push((i + 1) * gridSize + j);
      if (j > 0) stack.push(i * gridSize + (j - 1));
      if (j + 1 < gridSize) stack.push(i * gridSize + (j + 1));
    }
    groups.push({
      groupId,
      kindId,
      cells: groupCells,
      bound: groupBound(groupCells, gridSize, cubeSize, origin),
    });
  }

  return { cells, groups };
}

/** Centre + radius enclosing every cell in the group. */
function groupBound(
  groupCells: Array<{ i: number; j: number }>,
  gridSize: number,
  cubeSize: number,
  origin: Vec2,
): BoundingCircle {
  // World-space centre of cell (i, j): origin + ((i - half) * cubeSize, (j - half) * cubeSize).
  const half = (gridSize - 1) / 2;
  let sumX = 0;
  let sumZ = 0;
  for (const c of groupCells) {
    sumX += origin.x + (c.i - half) * cubeSize;
    sumZ += origin.z + (c.j - half) * cubeSize;
  }
  const centroid: Vec2 = {
    x: sumX / groupCells.length,
    z: sumZ / groupCells.length,
  };
  // Cell circle radius (cell's half-diagonal).
  const cellR = (Math.SQRT2 * cubeSize) / 2;
  let maxD = 0;
  for (const c of groupCells) {
    const cx = origin.x + (c.i - half) * cubeSize;
    const cz = origin.z + (c.j - half) * cubeSize;
    const dx = cx - centroid.x;
    const dz = cz - centroid.z;
    const d = Math.sqrt(dx * dx + dz * dz) + cellR;
    if (d > maxD) maxD = d;
  }
  return { center: centroid, radius: maxD };
}

/** Helper exported for tests: get the kindId at a (i, j) cell. */
export function kindAtCell(
  map: WorldMap,
  i: number,
  j: number,
): CubeKindId | '' {
  for (const layer of map.layers) {
    if (layer.cells.some((c) => c.i === i && c.j === j)) return layer.kind;
  }
  return '';
}
