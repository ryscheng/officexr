import { describe, expect, it } from 'vitest';
import { resolveHorizonColor, sunSkyParams } from './SkyDome.tsx';

describe('sunSkyParams', () => {
  it('points at the sun offset and keeps the disc the angular size of a sphere of that radius', () => {
    const { direction, angularRadius } = sunSkyParams([30, 40, 0], 5);
    expect(direction.toArray()).toEqual([0.6, 0.8, 0]);
    expect(angularRadius).toBeCloseTo(Math.atan(5 / 50));
  });

  it('points straight up for a zero offset', () => {
    expect(sunSkyParams([0, 0, 0], 3).direction.toArray()).toEqual([0, 1, 0]);
  });
});

describe('resolveHorizonColor', () => {
  it('uses the configured horizon colour', () => {
    expect(resolveHorizonColor('#000000', '#ffffff', '#ff8800').getHexString()).toBe('ff8800');
  });

  it('falls back to the two-stop gradient\'s colour at the horizon, close to the bottom', () => {
    const horizon = resolveHorizonColor('#ffffff', '#000000');
    expect(horizon.r).toBeCloseTo(0.0741, 3);
    expect(horizon.g).toBeCloseTo(0.0741, 3);
  });
});
