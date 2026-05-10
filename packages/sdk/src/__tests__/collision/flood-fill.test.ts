import { describe, it, expect } from 'vitest';
import { groupConnectedCubes } from '../../collision/flood-fill.ts';
import type { WorldMap } from '../../game-state/types.ts';

const WALL = 'wall';
const FLOOR = 'floor';

function makeMap(
  layers: Array<{ kind: string; cells: Array<{ i: number; j: number }> }>,
): WorldMap {
  return {
    gridSize: 6,
    cubeSize: 2,
    origin: { x: 0, z: 0 },
    layers,
    kinds: {
      [FLOOR]: { id: FLOOR, walkable: true },
      [WALL]: { id: WALL, walkable: false },
    },
  };
}

describe('groupConnectedCubes', () => {
  it('returns no groups for an empty / all-walkable map', () => {
    const map = makeMap([]);
    const r = groupConnectedCubes(map);
    expect(r.groups).toHaveLength(0);
  });

  it('one solitary obstacle cell → one group, one cell', () => {
    const map = makeMap([{ kind: WALL, cells: [{ i: 2, j: 3 }] }]);
    const r = groupConnectedCubes(map);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].kindId).toBe(WALL);
    expect(r.groups[0].cells).toEqual([{ i: 2, j: 3 }]);
    expect(r.cells[2 * 6 + 3]).toBe(0);
  });

  it('two 4-adjacent same-kind cells → ONE group', () => {
    const map = makeMap([
      {
        kind: WALL,
        cells: [
          { i: 1, j: 1 },
          { i: 1, j: 2 },
        ],
      },
    ]);
    const r = groupConnectedCubes(map);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].cells).toHaveLength(2);
  });

  it('only-diagonally-touching cells → TWO groups (4-neighbour rule)', () => {
    const map = makeMap([
      {
        kind: WALL,
        cells: [
          { i: 1, j: 1 },
          { i: 2, j: 2 },
        ],
      },
    ]);
    const r = groupConnectedCubes(map);
    expect(r.groups).toHaveLength(2);
  });

  it('two adjacent cells of DIFFERENT kinds → TWO groups', () => {
    const map: WorldMap = {
      ...makeMap([]),
      kinds: {
        [FLOOR]: { id: FLOOR, walkable: true },
        [WALL]: { id: WALL, walkable: false },
        glass: { id: 'glass', walkable: false },
      },
      layers: [
        { kind: WALL, cells: [{ i: 1, j: 1 }] },
        { kind: 'glass', cells: [{ i: 1, j: 2 }] },
      ],
    };
    const r = groupConnectedCubes(map);
    expect(r.groups).toHaveLength(2);
  });

  it('walkable kinds are skipped', () => {
    const map = makeMap([
      { kind: FLOOR, cells: [{ i: 0, j: 0 }] },
      { kind: WALL, cells: [{ i: 4, j: 4 }] },
    ]);
    const r = groupConnectedCubes(map);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].kindId).toBe(WALL);
  });

  it('group bound circle covers every member cell', () => {
    const map = makeMap([
      {
        kind: WALL,
        cells: [
          { i: 1, j: 1 },
          { i: 1, j: 2 },
          { i: 2, j: 2 },
        ],
      },
    ]);
    const r = groupConnectedCubes(map);
    const g = r.groups[0];
    const half = (6 - 1) / 2;
    for (const c of g.cells) {
      const cx = (c.i - half) * 2;
      const cz = (c.j - half) * 2;
      const dx = cx - g.bound.center.x;
      const dz = cz - g.bound.center.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      // bound radius must reach to the far edge of every cell
      expect(dist + Math.SQRT2).toBeLessThanOrEqual(g.bound.radius + 1e-9);
    }
  });
});
