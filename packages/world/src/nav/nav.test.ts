import { describe, expect, it } from 'vitest';
import type { ColliderDescriptor } from '../physics/rules.ts';
import { STEP_UP_MAX_HEIGHT } from '../physics/step-up.ts';
import { CHAR_HEIGHT_M } from '../renderer/config.ts';
import { buildNavGrid, type NavGrid } from './grid.ts';
import { findPath } from './path.ts';

const CHAR_RADIUS = 0.4;
const CELL = 0.25;
const FLOOR_TOP = 2;

function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): ColliderDescriptor {
  return {
    type: 'cuboid',
    center: { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2 },
    halfExtents: { x: (x1 - x0) / 2, y: (y1 - y0) / 2, z: (z1 - z0) / 2 },
  };
}

/** A wall standing on the floor, spanning x0..x1 and z0..z1. */
const wall = (x0: number, x1: number, z0: number, z1: number) => box(x0, x1, FLOOR_TOP, FLOOR_TOP + 3, z0, z1);

function grid(...extra: ColliderDescriptor[]): NavGrid {
  return buildNavGrid([box(-10, 10, 0, FLOOR_TOP, -10, 10), ...extra], {
    charRadius: CHAR_RADIUS,
    charHeight: CHAR_HEIGHT_M,
    maxStep: STEP_UP_MAX_HEIGHT,
  });
}

const onFloor = (x: number, z: number) => ({ x, y: FLOOR_TOP, z });

function walkableAt(g: NavGrid, x: number, z: number): boolean {
  const i = Math.floor((x - g.origin.x) / g.cellSize);
  const j = Math.floor((z - g.origin.z) / g.cellSize);
  return g.walkable[j * g.width + i] === 1;
}

/** Points every 5 cm along the path's segments. */
function samples(path: { x: number; z: number }[]): { x: number; z: number }[] {
  const out = [path[0]];
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1];
    const b = path[k];
    const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.05);
    for (let s = 1; s <= n; s++) {
      out.push({ x: a.x + ((b.x - a.x) * s) / n, z: a.z + ((b.z - a.z) * s) / n });
    }
  }
  return out;
}

/** The x where the path crosses the line z = `z`. */
function crossingX(path: { x: number; z: number }[], z: number): number {
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1];
    const b = path[k];
    if ((a.z - z) * (b.z - z) <= 0 && a.z !== b.z) {
      return a.x + ((b.x - a.x) * (z - a.z)) / (b.z - a.z);
    }
  }
  throw new Error(`path never crosses z=${z}`);
}

describe('findPath', () => {
  it('crosses an open floor in one segment', () => {
    const path = findPath(grid(), onFloor(-5, -3), onFloor(5, 4));
    expect(path).toHaveLength(2);
    expect(path![0].x).toBeCloseTo(-5, 0);
    expect(path![1].z).toBeCloseTo(4, 0);
  });

  it('routes through the doorway of a wall, under its lintel', () => {
    const g = grid(wall(-10, -0.8, 0, 0.5), wall(0.8, 10, 0, 0.5), box(-0.8, 0.8, 4.2, 5, 0, 0.5));
    const path = findPath(g, onFloor(-6, -4), onFloor(-6, 4));
    expect(path).not.toBeNull();
    expect(Math.abs(crossingX(path!, 0.25))).toBeLessThan(0.8);
  });

  it('returns null out of a closed room', () => {
    const g = grid(wall(-3, 3, -3, -2.5), wall(-3, 3, 2.5, 3), wall(-3, -2.5, -3, 3), wall(2.5, 3, -3, 3));
    expect(findPath(g, onFloor(0, 0), onFloor(6, 6))).toBeNull();
  });

  describe('a staircase up to a platform', () => {
    const platform = box(3.5, 10, FLOOR_TOP, FLOOR_TOP + 3, -10, 10);
    const steps = [1, 2, 3, 4, 5].map((k) => box(1 + (k - 1) * 0.5, 1 + k * 0.5, FLOOR_TOP, FLOOR_TOP + k * 0.5, -2, 2));
    const top = { x: 7, y: FLOOR_TOP + 3, z: 0 };

    it('connects the floor to the platform', () => {
      const path = findPath(grid(platform, ...steps), onFloor(-5, 0), top);
      expect(path).not.toBeNull();
      expect(path!.at(-1)!.x).toBeGreaterThan(3.5);
    });

    it('does not climb the platform without the steps', () => {
      expect(findPath(grid(platform), onFloor(-5, 0), top)).toBeNull();
    });
  });

  describe('a table-height block', () => {
    const g = grid(box(-0.5, 0.5, FLOOR_TOP, FLOOR_TOP + 0.8, -0.5, 0.5));

    it('is not walkable onto', () => {
      expect(walkableAt(g, 0, 0)).toBe(false);
      expect(findPath(g, onFloor(-5, 0), { x: 0, y: FLOOR_TOP + 0.8, z: 0 })).toBeNull();
    });

    it('still leads to a target standing beside it', () => {
      const path = findPath(g, onFloor(-5, 0), onFloor(0.7, 0));
      expect(path).not.toBeNull();
      expect(path!.at(-1)!.x).toBeGreaterThan(0.5);
    });
  });

  it('keeps the path a body radius from walls, to within half a cell', () => {
    const g = grid(wall(-1, 10, -0.25, 0.25));
    const path = findPath(g, onFloor(3, -3), onFloor(3, 3));
    expect(path).not.toBeNull();
    for (const p of samples(path!)) {
      const dx = Math.max(-1 - p.x, 0, p.x - 10);
      const dz = Math.max(-0.25 - p.z, 0, p.z - 0.25);
      expect(Math.hypot(dx, dz)).toBeGreaterThanOrEqual(CHAR_RADIUS - CELL / 2);
    }
  });

  it('passes a 1 m gap', () => {
    const g = grid(wall(-10, -0.5, -0.25, 0.25), wall(0.5, 10, -0.25, 0.25));
    const path = findPath(g, onFloor(-4, -4), onFloor(4, 4));
    expect(path).not.toBeNull();
    expect(Math.abs(crossingX(path!, 0))).toBeLessThan(0.5);
  });

  it('does not walk off the floor edge', () => {
    const g = grid();
    expect(walkableAt(g, 9.5, 0)).toBe(true);
    expect(walkableAt(g, 9.9, 0)).toBe(false);
    expect(walkableAt(g, 10.2, 0)).toBe(false);
    expect(findPath(g, onFloor(0, 0), onFloor(20, 0))).toBeNull();
  });

  it('searches a 240×240 grid well within a frame budget', () => {
    // A 60 m floor cut by long walls that force a zig-zag route.
    const half = 30;
    const g = buildNavGrid(
      [
        box(-half, half, 0, FLOOR_TOP, -half, half),
        ...[-20, -10, 0, 10, 20].map((z, k) =>
          k % 2 === 0 ? wall(-half, half - 3, z, z + 0.5) : wall(-half + 3, half, z, z + 0.5),
        ),
      ],
      { charRadius: CHAR_RADIUS, charHeight: CHAR_HEIGHT_M, maxStep: STEP_UP_MAX_HEIGHT },
    );
    expect(g.width).toBeGreaterThanOrEqual(240);
    expect(g.height).toBeGreaterThanOrEqual(240);
    const from = onFloor(-28, -28);
    const to = onFloor(-28, 28);
    findPath(g, from, to);
    // Best of three, so a CI box busy with other suites doesn't fail it.
    let elapsed = Infinity;
    for (let run = 0; run < 3; run++) {
      const t0 = performance.now();
      expect(findPath(g, from, to)).not.toBeNull();
      elapsed = Math.min(elapsed, performance.now() - t0);
    }
    expect(elapsed).toBeLessThan(50);
  });
});
