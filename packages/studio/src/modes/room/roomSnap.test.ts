import { describe, it, expect } from 'vitest';
import {
  quantizeAxisAlignedNormal,
  snapToVoxel,
  type CubeHit,
  type FloorHit,
} from './roomSnap.ts';

describe('quantizeAxisAlignedNormal', () => {
  it('returns +x for an x-dominant normal', () => {
    expect(quantizeAxisAlignedNormal([0.98, 0.1, -0.15])).toEqual([1, 0, 0]);
  });

  it('returns -x for a negative x-dominant normal', () => {
    expect(quantizeAxisAlignedNormal([-0.95, 0.2, 0.1])).toEqual([-1, 0, 0]);
  });

  it('returns +y for a y-dominant normal (typical "top of cube")', () => {
    expect(quantizeAxisAlignedNormal([0.05, 0.99, -0.1])).toEqual([0, 1, 0]);
  });

  it('returns -y for a -y-dominant normal (bottom of cube)', () => {
    expect(quantizeAxisAlignedNormal([0.0, -1.0, 0.0])).toEqual([0, -1, 0]);
  });

  it('returns +z for a z-dominant normal', () => {
    expect(quantizeAxisAlignedNormal([0.05, 0.0, 0.98])).toEqual([0, 0, 1]);
  });

  it('defaults to +x on a degenerate all-zero normal', () => {
    // Should never happen with a real raycast hit; the test pins the
    // tie-break behavior. `>=` on each axis means the first conditional
    // (x dominance) wins ties, and `Math.sign(0) === 0` triggers the
    // `s === 0 ? 1 : s` fallback.
    expect(quantizeAxisAlignedNormal([0, 0, 0])).toEqual([1, 0, 0]);
  });
});

describe('snapToVoxel (floor hit)', () => {
  function floorHit(x: number, z: number): FloorHit {
    return { kind: 'floor', point: { x, y: 0, z } };
  }

  it('rounds the floor hit to integer voxel coords with y = 0', () => {
    expect(snapToVoxel(floorHit(0, 0), 2)).toEqual([0, 0, 0]);
    expect(snapToVoxel(floorHit(2.1, -3.9), 2)).toEqual([1, 0, -2]);
    // -1.0 / 2 = -0.5 and Math.round(-0.5) → 0 in JS (rounds toward
    // +∞ for half-values). Pins the JS-rounding behavior so we don't
    // accidentally substitute Math.floor.
    expect(snapToVoxel(floorHit(-1.0, 1.0), 2)).toEqual([-0, 0, 1]);
    expect(snapToVoxel(floorHit(-1.6, 1.0), 2)).toEqual([-1, 0, 1]);
  });

  it('respects the cubeSize divisor', () => {
    expect(snapToVoxel(floorHit(4, 4), 4)).toEqual([1, 0, 1]);
    expect(snapToVoxel(floorHit(4, 4), 2)).toEqual([2, 0, 2]);
  });
});

describe('snapToVoxel (cube hit)', () => {
  function cubeHit(
    cubePosition: [number, number, number],
    faceNormal: [number, number, number],
  ): CubeHit {
    return { kind: 'cube', cubePosition, faceNormal };
  }

  it('snaps to the +y voxel above a top-face hit', () => {
    expect(
      snapToVoxel(cubeHit([3, 0, 7], [0.01, 0.99, 0.02]), 2),
    ).toEqual([3, 1, 7]);
  });

  it('snaps to the +x voxel right of an east-face hit', () => {
    expect(
      snapToVoxel(cubeHit([0, 0, 0], [1.0, 0.0, 0.0]), 2),
    ).toEqual([1, 0, 0]);
  });

  it('snaps to the -z voxel north of a back-face hit', () => {
    expect(
      snapToVoxel(cubeHit([5, 2, 1], [0.0, 0.0, -1.0]), 2),
    ).toEqual([5, 2, 0]);
  });

  it('cubeSize does not affect cube-hit snapping (already in voxel coords)', () => {
    expect(
      snapToVoxel(cubeHit([10, 0, 10], [0, 1, 0]), 100),
    ).toEqual([10, 1, 10]);
  });
});
