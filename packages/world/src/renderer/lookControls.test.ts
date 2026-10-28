import { describe, expect, it } from 'vitest';
import {
  applyLookDelta,
  applyZoom,
  fixedMovementYaw,
  fixedLeash,
  pinchFactor,
  PITCH_MAX,
  PITCH_MIN,
  ZOOM_MAX,
  ZOOM_MIN,
  yawFromDirection,
  zoomedFov,
  type LookRefs,
  type ViewOffsets,
} from './lookControls.ts';
import { CHAR_HEIGHT_M } from './config.ts';

const deg = (d: number) => (d * Math.PI) / 180;

const offsets = (over: Partial<ViewOffsets> = {}): ViewOffsets => ({
  fixedAzimuthOffsetRad: 0,
  fixedPitchOffsetRad: 0,
  zoom: 1,
  ...over,
});

const refs = (): LookRefs => ({
  yawRef: { current: 0 },
  pitchRef: { current: -0.25 },
  viewOffsetsRef: { current: offsets() },
});

describe('applyLookDelta', () => {
  it.each(['first-person', 'third-person'] as const)('drives yaw/pitch in %s', (mode) => {
    const r = refs();
    applyLookDelta(mode, 0.1, 0.2, r);
    expect(r.yawRef.current).toBeCloseTo(0.1);
    expect(r.pitchRef.current).toBeCloseTo(-0.05);
    expect(r.viewOffsetsRef.current).toEqual(offsets());
  });

  it('clamps pitch', () => {
    const r = refs();
    applyLookDelta('first-person', 0, 100, r);
    expect(r.pitchRef.current).toBe(PITCH_MAX);
    applyLookDelta('first-person', 0, -100, r);
    expect(r.pitchRef.current).toBe(PITCH_MIN);
  });

  it('orbits the fixed camera and leaves yaw/pitch alone', () => {
    const r = refs();
    applyLookDelta('fixed', 0.1, 0.2, r);
    expect(r.yawRef.current).toBe(0);
    expect(r.pitchRef.current).toBe(-0.25);
    expect(r.viewOffsetsRef.current.fixedAzimuthOffsetRad).toBeCloseTo(-0.1);
    expect(r.viewOffsetsRef.current.fixedPitchOffsetRad).toBeCloseTo(-0.2);
  });

  it.each(['top-down', 'free-fly'] as const)('ignores %s', (mode) => {
    const r = refs();
    applyLookDelta(mode, 1, 1, r);
    expect(r.yawRef.current).toBe(0);
    expect(r.pitchRef.current).toBe(-0.25);
    expect(r.viewOffsetsRef.current).toEqual(offsets());
  });
});

describe('applyZoom', () => {
  it('multiplies the zoom', () => {
    const o = offsets();
    applyZoom(1.5, o);
    expect(o.zoom).toBe(1.5);
  });

  it('clamps the zoom', () => {
    const o = offsets();
    applyZoom(100, o);
    expect(o.zoom).toBe(ZOOM_MAX);
    applyZoom(0.001, o);
    expect(o.zoom).toBe(ZOOM_MIN);
  });
});

describe('pinchFactor', () => {
  it('is above 1 when the fingers spread and below 1 when they close', () => {
    expect(pinchFactor(100, 150)).toBe(1.5);
    expect(pinchFactor(100, 50)).toBe(0.5);
  });

  it('ignores a zero starting distance', () => {
    expect(pinchFactor(0, 50)).toBe(1);
  });
});

describe('zoomedFov', () => {
  it('maps the zoom range onto the fov bounds without a dead zone', () => {
    expect(zoomedFov(75, 1)).toBe(75);
    expect(zoomedFov(75, ZOOM_MIN)).toBeCloseTo(100);
    expect(zoomedFov(75, ZOOM_MAX)).toBeCloseTo(30);
    let prev = Infinity;
    for (let z = ZOOM_MIN; z <= ZOOM_MAX; z += 0.1) {
      const fov = zoomedFov(75, z);
      expect(fov).toBeLessThan(prev);
      prev = fov;
    }
  });
});

describe('fixedLeash', () => {
  const basePitch = deg(-35);
  const defaults = {
    height: 25,
    maxOnScreenFrac: 0.25,
    minOnScreenFrac: 0.08,
    lateralFrac: 0.4,
    fov: 50,
  };
  const baseLeash = fixedLeash(basePitch, defaults, offsets());

  it('reproduces the unrotated screen-fraction leash with zero offsets and zoom 1', () => {
    const tanHalfFov = Math.tan(deg(25));
    const hOff = 25 - CHAR_HEIGHT_M / 2;
    const near3D = CHAR_HEIGHT_M / (2 * 0.25 * tanHalfFov);
    const far3D = CHAR_HEIGHT_M / (2 * 0.08 * tanHalfFov);
    const min = (hOff / Math.tan(deg(35))) * 0.6;
    const max = Math.sqrt(far3D ** 2 - hOff ** 2);
    expect(baseLeash.height).toBe(25);
    expect(baseLeash.pitchRad).toBe(basePitch);
    expect(near3D).toBeLessThan(hOff);
    expect(far3D).toBeGreaterThan(hOff);
    expect(baseLeash.minDistance).toBeCloseTo(min);
    expect(baseLeash.maxDistance).toBeCloseTo(Math.max(min + 0.5, max));
    expect(baseLeash.maxLateral).toBeCloseTo(0.4 * baseLeash.maxDistance * tanHalfFov);
  });

  it('keeps the avatar within the fov across the elevation and zoom clamps', () => {
    for (const elevation of [deg(10), deg(35), deg(85)]) {
      for (const zoom of [ZOOM_MIN, 1, ZOOM_MAX]) {
        const leash = fixedLeash(
          basePitch,
          defaults,
          offsets({ fixedPitchOffsetRad: elevation - deg(35), zoom }),
        );
        expect(leash.pitchRad).toBeCloseTo(-elevation);
        for (const depth of [leash.minDistance, leash.maxDistance]) {
          for (const y of [0, CHAR_HEIGHT_M / 2, CHAR_HEIGHT_M]) {
            const below = Math.atan2(leash.height - y, depth);
            expect(Math.abs(below - elevation)).toBeLessThan(deg(defaults.fov / 2));
          }
        }
      }
    }
  });

  it('rotates a pinned distance with the elevation and keeps the reference on the look axis', () => {
    const base = deg(8);
    const pinned = { ...defaults, height: 4 * Math.tan(base), distanceM: 4 };
    const flat = fixedLeash(-base, pinned, offsets());
    expect(flat.minDistance).toBe(4);
    expect(flat.maxDistance).toBe(4);
    expect(flat.maxLateral).toBe(0);
    const steep = fixedLeash(-base, pinned, offsets({ fixedPitchOffsetRad: deg(90) }));
    expect(steep.pitchRad).toBeCloseTo(deg(-85));
    expect(steep.minDistance).toBeCloseTo((4 * Math.cos(deg(85))) / Math.cos(base));
    expect(Math.atan2(steep.height, steep.minDistance)).toBeCloseTo(deg(85));
  });

  it('clamps the elevation to 10-85 degrees and reports the offset in effect', () => {
    const top = fixedLeash(basePitch, defaults, offsets({ fixedPitchOffsetRad: deg(90) }));
    expect(top.pitchRad).toBeCloseTo(deg(-85));
    expect(top.pitchOffsetRad).toBeCloseTo(deg(50));
    const bottom = fixedLeash(basePitch, defaults, offsets({ fixedPitchOffsetRad: deg(-90) }));
    expect(bottom.pitchRad).toBeCloseTo(deg(-10));
    expect(bottom.pitchOffsetRad).toBeCloseTo(deg(-25));
  });

  it('keeps a base elevation outside the clamp reachable and unchanged', () => {
    const shallow = fixedLeash(deg(-8), defaults, offsets({ fixedPitchOffsetRad: deg(-5) }));
    expect(shallow.pitchRad).toBe(deg(-8));
    expect(shallow.pitchOffsetRad).toBe(0);
  });

  it('does not orbit a camera that does not look down', () => {
    const level = fixedLeash(0, defaults, offsets({ fixedPitchOffsetRad: deg(30) }));
    expect(level.pitchOffsetRad).toBe(0);
    expect(level.height).toBe(25);
  });
});

describe('fixedMovementYaw', () => {
  it('matches the unrotated camera yaw with zero offsets', () => {
    expect(fixedMovementYaw(202.5, 0, 0)).toBe(Math.PI - deg(202.5));
    expect(fixedMovementYaw(202.5, 0, 10)).toBe(Math.PI - deg(202.5) + deg(10));
  });

  it('subtracts the azimuth offset', () => {
    expect(fixedMovementYaw(202.5, 0.3, 0)).toBeCloseTo(Math.PI - deg(202.5) - 0.3);
  });

  it('follows the on-screen direction after a right-hand drag', () => {
    const r = refs();
    applyLookDelta('fixed', -0.5, 0, r);
    const yaw = fixedMovementYaw(0, r.viewOffsetsRef.current.fixedAzimuthOffsetRad, 0);
    // Camera yaw as first-person look would have it after the same drag.
    expect(yaw).toBeCloseTo(Math.PI - 0.5);
  });
});

describe('yawFromDirection', () => {
  it.each([0, 0.7, -2.4, Math.PI / 2])('inverts the yaw convention at yaw %s, whatever the pitch', (yaw) => {
    for (const pitch of [0, -0.6, 1.1]) {
      const dir = { x: -Math.sin(yaw) * Math.cos(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
      expect(yawFromDirection(dir)).toBeCloseTo(yaw);
    }
  });
});
