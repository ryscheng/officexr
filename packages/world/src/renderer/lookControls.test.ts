import { describe, expect, it } from 'vitest';
import {
  applyLookDelta,
  applyZoom,
  fixedMovementYaw,
  fixedOrbit,
  pinchFactor,
  PITCH_MAX,
  PITCH_MIN,
  ZOOM_MAX,
  ZOOM_MIN,
  zoomedFov,
  type LookRefs,
  type ViewOffsets,
} from './lookControls.ts';

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
  it('narrows the fov as the zoom grows, within bounds', () => {
    expect(zoomedFov(75, 1)).toBe(75);
    expect(zoomedFov(75, 1.5)).toBe(50);
    expect(zoomedFov(75, ZOOM_MAX)).toBe(30);
    expect(zoomedFov(75, ZOOM_MIN)).toBe(100);
  });
});

describe('fixedOrbit', () => {
  const basePitch = deg(-35);

  it('returns the inputs unchanged with zero offsets', () => {
    const o = fixedOrbit(basePitch, 25, offsets());
    expect(o.pitchRad).toBe(basePitch);
    expect(o.orbitHeight).toBe(25);
    expect(o.azimuthOffsetRad).toBe(0);
  });

  it('raises the camera and steepens the pitch for a positive offset', () => {
    const o = fixedOrbit(basePitch, 25, offsets({ fixedPitchOffsetRad: deg(20) }));
    expect(o.pitchRad).toBeCloseTo(deg(-55));
    expect(o.orbitHeight).toBeCloseTo((25 * Math.sin(deg(55))) / Math.sin(deg(35)));
  });

  it('clamps the elevation to 10-85 degrees and reports the offset in effect', () => {
    const top = fixedOrbit(basePitch, 25, offsets({ fixedPitchOffsetRad: deg(90) }));
    expect(top.pitchRad).toBeCloseTo(deg(-85));
    expect(top.pitchOffsetRad).toBeCloseTo(deg(50));
    const bottom = fixedOrbit(basePitch, 25, offsets({ fixedPitchOffsetRad: deg(-90) }));
    expect(bottom.pitchRad).toBeCloseTo(deg(-10));
    expect(bottom.pitchOffsetRad).toBeCloseTo(deg(-25));
  });

  it('keeps a base elevation outside the clamp reachable and unchanged', () => {
    const shallow = deg(-8);
    expect(fixedOrbit(shallow, 3, offsets()).pitchRad).toBe(shallow);
    expect(fixedOrbit(shallow, 3, offsets({ fixedPitchOffsetRad: deg(-5) })).pitchRad).toBe(shallow);
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
