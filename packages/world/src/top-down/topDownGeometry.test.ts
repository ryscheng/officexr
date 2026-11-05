import { describe, expect, it } from 'vitest';
import { fitTransform, playerAt, screenToWorld, unionBounds, worldToScreen } from './topDownGeometry.ts';

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

  describe('playerAt', () => {
    const t = { scale: 10, offsetX: 0, offsetY: 0 };
    const players = { me: { pos: { x: 1, z: 1 } }, a: { pos: { x: 2, z: 2 } }, b: { pos: { x: 2.4, z: 2 } } };

    it('returns the nearest player in range', () => {
      expect(playerAt({ x: 21, y: 20 }, players, t, 'me', 10)).toBe('a');
      expect(playerAt({ x: 23, y: 20 }, players, t, 'me', 10)).toBe('b');
    });

    it('ignores self', () => {
      expect(playerAt({ x: 10, y: 10 }, players, t, 'me', 5)).toBeNull();
    });

    it('returns null out of range', () => {
      expect(playerAt({ x: 100, y: 100 }, players, t, 'me', 10)).toBeNull();
    });
  });
});
