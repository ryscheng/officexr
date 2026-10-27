import { describe, it, expect } from 'vitest';
import { overlapsAnyInstance } from './footprint.ts';
import { BEAM, NOISY, WALL, footprintOf, geometry } from './__tests__/yawedKinds.ts';

const sizeOf = (box: { min: readonly number[]; max: readonly number[] }) =>
  box.max.map((hi, i) => hi - box.min[i]);

describe('createFootprintOf', () => {
  it('yaw 0 is the tile step at the position', () => {
    expect(footprintOf([3, 1, 5], WALL.id)).toEqual({ min: [3, 1, 5], max: [7, 4, 6] });
    expect(footprintOf([3, 1, 5], WALL.id, 360)).toEqual(footprintOf([3, 1, 5], WALL.id));
    expect(footprintOf([3, 1, 5], WALL.id, 180)).toEqual(footprintOf([3, 1, 5], WALL.id));
  });

  it('an even width-depth difference swaps cleanly onto the grid', () => {
    expect(footprintOf([0, 0, 0], BEAM.id, 90)).toEqual({ min: [1, 0, -1], max: [3, 3, 3] });
    expect(footprintOf([0, 0, 0], BEAM.id, 270)).toEqual(footprintOf([0, 0, 0], BEAM.id, 90));
  });

  it('an odd difference keeps the swapped size, not the 2×5 that rounding the AABB outward gives', () => {
    const box = footprintOf([0, 0, 0], WALL.id, 90);
    expect(sizeOf(box)).toEqual([1, 3, 4]);
    expect(sizeOf(geometry.voxelFootprint([0, 0, 0], WALL.id, 90))).toEqual([2, 3, 5]);
    expect(box).toEqual({ min: [2, 0, -1], max: [3, 3, 3] });
  });

  it('translates with the position', () => {
    const at = footprintOf([10, 2, -6], WALL.id, 90);
    const origin = footprintOf([0, 0, 0], WALL.id, 90);
    expect(at.min).toEqual([origin.min[0] + 10, origin.min[1] + 2, origin.min[2] - 6]);
    expect(sizeOf(at)).toEqual(sizeOf(origin));
  });
});

describe('overlapsAnyInstance', () => {
  const placed = [{ position: [0, 0, 0] as const, kindId: NOISY.id }];

  it('lets a float-noise kind sit flush beside itself, which rounding the AABB outward refused', () => {
    expect(overlapsAnyInstance(footprintOf([2, 0, 0], NOISY.id), placed, footprintOf)).toBe(false);
    const outward = (p: readonly [number, number, number], k: string) =>
      geometry.voxelFootprint(p, k);
    expect(overlapsAnyInstance(outward([2, 0, 0], NOISY.id), placed, outward)).toBe(true);
  });

  it('still refuses a real overlap', () => {
    expect(overlapsAnyInstance(footprintOf([1, 0, 0], NOISY.id), placed, footprintOf)).toBe(true);
  });

  it('checks against yawed instances by their rotated footprint', () => {
    const wall = [{ position: [0, 0, 0] as const, kindId: WALL.id, yawDeg: 90 }];
    expect(overlapsAnyInstance(footprintOf([2, 0, 2], 'peg'), wall, footprintOf)).toBe(true);
    expect(overlapsAnyInstance(footprintOf([3, 0, 0], 'peg'), wall, footprintOf)).toBe(false);
  });
});
