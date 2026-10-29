import type { NavGrid } from '@officexr/world/react';
import { describe, expect, it } from 'vitest';
import { navGridPath, toMinimap } from './minimapGeometry';

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

describe('navGridPath', () => {
  it('merges walkable runs into rectangles, extending them down rows that repeat them', () => {
    const rows = ['1101', '1100', '0111'];
    const grid: NavGrid = {
      origin: { x: 0, z: 0 },
      cellSize: 0.25,
      width: 4,
      height: rows.length,
      maxStep: 0.3,
      walkable: Uint8Array.from(rows.join(''), Number),
      surface: new Float32Array(12),
    };
    const rects = navGridPath(grid).split(/(?=M)/).sort();
    expect(rects).toEqual(['M0 0h2v2h-2z', 'M1 2h3v1h-3z', 'M3 0h1v1h-1z']);
  });
});
