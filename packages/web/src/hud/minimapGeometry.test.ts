import type { NavGrid } from '@officexr/world/react';
import { describe, expect, it } from 'vitest';
import { floorPlanTransform, navGridPath, toMinimap } from './minimapGeometry';

const opts = { rangeM: 40, sizePx: 200 };
const self = { x: 3, y: 1, z: -2 };

describe('toMinimap', () => {
  for (const yaw of [0, Math.PI / 2, -Math.PI / 3, 2.5, Math.PI]) {
    const ahead = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
    const right = { x: Math.cos(yaw), z: -Math.sin(yaw) };
    const at = (dir: { x: number; z: number }, m: number) => ({ x: self.x + dir.x * m, y: 7, z: self.z + dir.z * m });

    it(`puts what is ahead above the centre and what is right to the right at yaw ${yaw.toFixed(2)}`, () => {
      const up = toMinimap(self, yaw, at(ahead, 10), opts);
      expect(up.x).toBeCloseTo(100);
      expect(up.y).toBeCloseTo(50);
      expect(up.clamped).toBe(false);

      const r = toMinimap(self, yaw, at(right, 5), opts);
      expect(r.x).toBeCloseTo(125);
      expect(r.y).toBeCloseTo(100);
    });
  }

  it('pins a point beyond range to the rim in its direction', () => {
    expect(toMinimap(self, 0, { x: self.x - 30, y: 0, z: self.z }, opts)).toEqual({ x: 0, y: 100, clamped: true });
  });

  it('puts yourself at the centre', () => {
    expect(toMinimap(self, 1, self, opts)).toEqual({ x: 100, y: 100, clamped: false });
  });
});

describe('floorPlanTransform', () => {
  const grid: NavGrid = {
    origin: { x: -3.5, z: -6.25 },
    cellSize: 0.25,
    width: 60,
    height: 60,
    maxStep: 0.3,
    walkable: new Uint8Array(3600),
    surface: new Float32Array(3600),
  };
  const centre = 117;
  const cells = [
    [0, 0],
    [13, 2],
    [40, 7],
    [5, 33],
    [59, 59],
  ];

  for (const yaw of [0, Math.PI / 2, -Math.PI / 3, 2.5, Math.PI]) {
    it(`puts each cell centre where toMinimap puts that point at yaw ${yaw.toFixed(2)}`, () => {
      const { a, b, c, d, e, f } = floorPlanTransform(grid, self, yaw, { ...opts, centre });
      for (const [i, j] of cells) {
        const [u, v] = [i + 0.5, j + 0.5];
        const point = { x: grid.origin.x + u * grid.cellSize, y: 0, z: grid.origin.z + v * grid.cellSize };
        const expected = toMinimap(self, yaw, point, opts);
        expect(expected.clamped).toBe(false);
        expect(a * u + c * v + e).toBeCloseTo(expected.x - opts.sizePx / 2 + centre);
        expect(b * u + d * v + f).toBeCloseTo(expected.y - opts.sizePx / 2 + centre);
      }
    });
  }
});

describe('navGridPath', () => {
  const gridOf = (rows: string[]): NavGrid => ({
    origin: { x: 0, z: 0 },
    cellSize: 0.25,
    width: rows[0].length,
    height: rows.length,
    maxStep: 0.3,
    walkable: Uint8Array.from(rows.join(''), Number),
    surface: new Float32Array(rows.join('').length),
  });
  const rectsOf = (rows: string[]) => navGridPath(gridOf(rows)).split(/(?=M)/).sort();

  it('is empty for a grid with nothing walkable', () => {
    expect(navGridPath(gridOf(['0000', '0000']))).toBe('');
  });

  it('starts a new rectangle where a run grows or shrinks', () => {
    expect(rectsOf(['1100', '1110', '1100'])).toEqual(['M0 0h2v1h-2z', 'M0 1h3v1h-3z', 'M0 2h2v1h-2z']);
  });

  it('merges walkable runs into rectangles, extending them down rows that repeat them', () => {
    expect(rectsOf(['1101', '1100', '0111'])).toEqual(['M0 0h2v2h-2z', 'M1 2h3v1h-3z', 'M3 0h1v1h-1z']);
  });
});
