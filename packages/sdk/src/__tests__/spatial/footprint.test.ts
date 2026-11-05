import { describe, expect, it } from 'vitest';
import { clampToFootprint, isInsideFootprint, type FootprintRect } from '../../spatial/footprint.ts';

const a: FootprintRect = { min: { x: 0, z: 0 }, max: { x: 10, z: 10 } };
const b: FootprintRect = { min: { x: 20, z: 0 }, max: { x: 30, z: 10 } };

describe('clampToFootprint', () => {
  it('keeps inside points', () => {
    const p = { x: 5, z: 5 };
    expect(clampToFootprint([a], p)).toBe(p);
  });
  it('clamps to the nearest edge or corner', () => {
    expect(clampToFootprint([a], { x: 15, z: 5 })).toEqual({ x: 10, z: 5 });
    expect(clampToFootprint([a], { x: -3, z: -4 })).toEqual({ x: 0, z: 0 });
  });
  it('lands in the nearest of several rects', () => {
    const r = clampToFootprint([a, b], { x: 18, z: 5 });
    expect(r).toEqual({ x: 20, z: 5 });
    expect(isInsideFootprint([a, b], r.x, r.z)).toBe(true);
  });
  it('returns the input for empty rects', () => {
    const p = { x: 99, z: 99 };
    expect(clampToFootprint([], p)).toBe(p);
  });
});
