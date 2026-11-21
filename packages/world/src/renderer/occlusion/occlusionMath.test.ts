import { describe, expect, it } from 'vitest';
import {
  FADED_OPACITY,
  FADE_SECONDS,
  isFloorLike,
  segmentBoxEntry,
  stepFade,
} from './occlusionMath.ts';

const wall = [-1, 0, -0.2, 1, 3, 0.2] as const;

function entry(a: [number, number, number], b: [number, number, number]) {
  return segmentBoxEntry(...a, ...b, ...wall);
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

  it('blocks at once when the viewer is inside the box', () => {
    expect(entry([0, 1, 0], [0, 1.5, 5])).toBe(0);
  });

  it('ignores a box the player stands inside', () => {
    expect(entry([0, 1.5, 5], [0, 1, 0])).toBe(-1);
  });

  it('misses a low prop under a high line of sight', () => {
    expect(segmentBoxEntry(0, 3, 5, 0, 1.5, -5, -1, 0, -0.2, 1, 0.5, 0.2)).toBe(-1);
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
