import { describe, expect, it } from 'vitest';
import { fitTransform, screenToWorld, unionBounds, worldToScreen } from './topDownGeometry.ts';

describe('topDownGeometry', () => {
  const bounds = { min: { x: -10, z: -5 }, max: { x: 10, z: 5 } };

  it('fits the bounds inside the padded size, centred', () => {
    const t = fitTransform(bounds, { width: 220, height: 220 }, 10);
    expect(t.scale).toBe(10);
    expect(worldToScreen(t, bounds.min)).toEqual({ x: 10, y: 60 });
    expect(worldToScreen(t, bounds.max)).toEqual({ x: 210, y: 160 });
  });

  it('puts -Z at the top of the view', () => {
    const t = fitTransform(bounds, { width: 100, height: 100 });
    expect(worldToScreen(t, { x: 0, z: -1 }).y).toBeLessThan(worldToScreen(t, { x: 0, z: 1 }).y);
  });

  it('round-trips screen and world points', () => {
    const t = fitTransform(bounds, { width: 640, height: 480 });
    const p = { x: 3.25, z: -1.5 };
    const back = screenToWorld(t, worldToScreen(t, p));
    expect(back.x).toBeCloseTo(p.x);
    expect(back.z).toBeCloseTo(p.z);
  });

  it('unions rects', () => {
    expect(unionBounds([])).toBeNull();
    expect(
      unionBounds([bounds, { min: { x: 0, z: 0 }, max: { x: 20, z: 1 } }]),
    ).toEqual({ min: { x: -10, z: -5 }, max: { x: 20, z: 5 } });
  });
});
