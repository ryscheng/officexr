import { describe, it, expect } from 'vitest';
import { buildCollisionWorld } from '../../collision/world.ts';
import { cellAt, cellCenter, forEachCellInRadius } from '../../collision/query.ts';
import type { WorldMap } from '../../game-state/types.ts';

const WALL = 'wall';
const FLOOR = 'floor';

function makeMap(): WorldMap {
  return {
    gridSize: 5,
    cubeSize: 2,
    origin: { x: 0, z: 0 },
    layers: [
      {
        kind: WALL,
        // a 1×3 horizontal wall
        cells: [
          { i: 2, j: 1 },
          { i: 2, j: 2 },
          { i: 2, j: 3 },
        ],
      },
    ],
    kinds: {
      [FLOOR]: { id: FLOOR, walkable: true },
      [WALL]: { id: WALL, walkable: false },
    },
  };
}

describe('cellAt / cellCenter', () => {
  const world = buildCollisionWorld(makeMap());

  it('cellAt(world origin) → centre cell', () => {
    // gridSize=5 → centre is (2, 2)
    expect(cellAt(world, 0, 0)).toEqual({ i: 2, j: 2 });
  });

  it('round-trips through cellCenter', () => {
    const c = cellCenter(world, 1, 3);
    expect(cellAt(world, c.x, c.z)).toEqual({ i: 1, j: 3 });
  });

  it('clamps out-of-bounds queries to grid extents', () => {
    expect(cellAt(world, -100, -100)).toEqual({ i: 0, j: 0 });
    expect(cellAt(world, +100, +100)).toEqual({ i: 4, j: 4 });
  });
});

describe('forEachCellInRadius', () => {
  const world = buildCollisionWorld(makeMap());

  it('visits exactly the solid cells within the swept circle', () => {
    // Character circle at the centre of the wall. With radius 0.5 it just
    // touches its own cell (i=2, j=2).
    const visited = new Set<string>();
    const c = cellCenter(world, 2, 2);
    forEachCellInRadius(world, c.x, c.z, 0.5, (i, j) => {
      visited.add(`${i},${j}`);
    });
    expect(visited).toEqual(new Set(['2,2']));
  });

  it('a wider sweep picks up neighbouring solid cells', () => {
    const visited: Array<[number, number]> = [];
    const c = cellCenter(world, 2, 2);
    forEachCellInRadius(world, c.x, c.z, 2.5, (i, j) => visited.push([i, j]));
    // The wall is (2,1), (2,2), (2,3) — all within reach of the broad sweep.
    const ids = new Set(visited.map(([i, j]) => `${i},${j}`));
    expect(ids).toEqual(new Set(['2,1', '2,2', '2,3']));
  });

  it('skips walkable / empty cells', () => {
    let calls = 0;
    forEachCellInRadius(world, 100, 100, 50, () => {
      calls++;
    });
    // far away, query ranges clamp to the grid corner — but the corner cell
    // is empty / walkable, so no visit.
    expect(calls).toBe(0);
  });
});
