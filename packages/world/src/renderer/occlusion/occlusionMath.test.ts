import { describe, expect, it } from 'vitest';
import {
  FADED_OPACITY,
  FADE_SECONDS,
  PULL_IN_MARGIN,
  PULL_IN_MIN_DISTANCE,
  easedDistance,
  isFloorLike,
  pulledInDistance,
  segmentBoxEntry,
  stepFade,
} from './occlusionMath.ts';

const wall = [-1, 0, -0.2, 1, 3, 0.2] as const;

function entry(a: [number, number, number], b: [number, number, number], endInside = false) {
  return segmentBoxEntry(...a, ...b, ...wall, endInside);
}

describe('segmentBoxEntry', () => {
  it('hits a wall between camera and player', () => {
    expect(entry([0, 1.5, 5], [0, 1.5, -5])).toBeCloseTo(0.48, 2);
  });

  it('misses a wall beside the line of sight', () => {
    expect(entry([4, 1.5, 5], [4, 1.5, -5])).toBe(-1);
  });

  it('misses a wall behind the player', () => {
    expect(entry([0, 1.5, 5], [0, 1.5, 1])).toBe(-1);
  });

  it('ignores a box the viewer starts inside', () => {
    expect(entry([0, 1, 0], [0, 1.5, 5])).toBe(-1);
  });

  it('ignores a box the player stands inside when the end must be outside', () => {
    expect(entry([0, 1.5, 5], [0, 1, 0])).toBe(-1);
  });

  it('counts a box containing the end point when asked', () => {
    expect(entry([0, 1.5, 5], [0, 1, 0], true)).toBeGreaterThan(0);
  });

  it('misses a low prop under a high line of sight', () => {
    expect(segmentBoxEntry(0, 3, 5, 0, 1.5, -5, -1, 0, -0.2, 1, 0.5, 0.2, false)).toBe(-1);
  });
});

describe('floors', () => {
  it('treats thin slabs as floor-like and walls as solid', () => {
    expect(isFloorLike(0.2)).toBe(true);
    expect(isFloorLike(2)).toBe(false);
  });
});

describe('stepFade', () => {
  it('fades to the target opacity in about 150 ms', () => {
    let v = 1;
    for (let t = 0; t < FADE_SECONDS; t += 0.01) v = stepFade(v, true, 0.01);
    expect(v).toBeCloseTo(FADED_OPACITY, 1);
    expect(stepFade(v, true, 1)).toBe(FADED_OPACITY);
  });

  it('returns to exactly 1 when clear', () => {
    expect(stepFade(FADED_OPACITY, false, 1)).toBe(1);
  });
});

describe('pulledInDistance', () => {
  it('keeps the desired distance with no hit', () => {
    expect(pulledInDistance(6, -1)).toBe(6);
  });

  it('stops a margin short of the first hit', () => {
    expect(pulledInDistance(6, 0.5)).toBeCloseTo(3 - PULL_IN_MARGIN);
  });

  it('never pulls through the player', () => {
    expect(pulledInDistance(6, 0.05)).toBe(PULL_IN_MIN_DISTANCE);
  });

  it('never exceeds the desired distance', () => {
    expect(pulledInDistance(0.5, 0.9)).toBeLessThanOrEqual(0.5);
  });
});

describe('easedDistance', () => {
  it('moves in faster than out', () => {
    const inward = 6 - easedDistance(6, 2, 0.05);
    const outward = easedDistance(2, 6, 0.05) - 2;
    expect(inward).toBeGreaterThan(outward * 2);
  });

  it('settles on the target', () => {
    let d = 6;
    for (let i = 0; i < 200; i++) d = easedDistance(d, 2, 0.016);
    expect(d).toBe(2);
  });
});
