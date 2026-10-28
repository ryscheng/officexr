import { describe, expect, it } from 'vitest';
import {
  GLITCH_THRESHOLD_DEG,
  isNaturalLandscape,
  lookDelta,
  toPose,
  type DeviceReading,
  type MotionPose,
} from './motionLook.ts';

const deg = (d: number) => (d * Math.PI) / 180;

const reading = (over: Partial<DeviceReading> = {}): DeviceReading => ({ alpha: 100, beta: 90, gamma: 0, ...over });

const pose = (over: Partial<MotionPose> = {}): MotionPose => ({ yawDeg: 100, pitchDeg: 0, screenAngle: 0, ...over });

describe('toPose', () => {
  it('has no pose without an alpha reading', () => {
    expect(toPose(reading({ alpha: null }), 0, false)).toBeNull();
  });

  it('takes yaw from alpha at every screen angle', () => {
    for (const angle of [0, 90, 180, 270]) {
      expect(toPose(reading({ alpha: 42 }), angle, true)?.yawDeg).toBe(42);
    }
  });

  it('reads pitch from beta in portrait and gamma in landscape on a natural-portrait device', () => {
    const r = reading({ beta: 80, gamma: 15 });
    expect(toPose(r, 0, false)?.pitchDeg).toBe(-10);
    expect(toPose(r, 90, false)?.pitchDeg).toBe(15);
    expect(toPose(r, 180, false)?.pitchDeg).toBe(-10);
    expect(toPose(r, 270, false)?.pitchDeg).toBe(-15);
  });

  it('reads pitch from gamma in landscape and mirrored beta in portrait on a natural-landscape device', () => {
    const r = reading({ beta: 80, gamma: 15 });
    expect(toPose(r, 0, true)?.pitchDeg).toBe(15);
    expect(toPose(r, 90, true)?.pitchDeg).toBe(-80);
    expect(toPose(r, 180, true)?.pitchDeg).toBe(15);
    expect(toPose(r, 270, true)?.pitchDeg).toBe(80);
  });

  it('falls back to an upright beta and a level gamma', () => {
    expect(toPose({ alpha: 0, beta: null, gamma: null }, 0, false)?.pitchDeg).toBe(0);
    expect(toPose({ alpha: 0, beta: null, gamma: null }, 0, true)?.pitchDeg).toBe(0);
  });

  it('records the screen angle it was read at', () => {
    expect(toPose(reading(), 270, true)?.screenAngle).toBe(270);
  });
});

describe('isNaturalLandscape', () => {
  it('follows the viewport at angle 0 and 180', () => {
    expect(isNaturalLandscape(0, true)).toBe(true);
    expect(isNaturalLandscape(180, false)).toBe(false);
  });

  it('inverts the viewport when the screen is rotated', () => {
    expect(isNaturalLandscape(90, false)).toBe(true);
    expect(isNaturalLandscape(270, true)).toBe(false);
  });
});

describe('lookDelta', () => {
  it('turns left (positive yaw) as alpha rises', () => {
    expect(lookDelta(pose({ yawDeg: 100 }), pose({ yawDeg: 105 })).dYaw).toBeCloseTo(deg(5));
  });

  it('looks up (positive pitch) as the raw pitch falls', () => {
    expect(lookDelta(pose({ pitchDeg: 0 }), pose({ pitchDeg: -4 })).dPitch).toBeCloseTo(deg(4));
  });

  it('wraps yaw across 0/360 in both directions', () => {
    expect(lookDelta(pose({ yawDeg: 358 }), pose({ yawDeg: 2 })).dYaw).toBeCloseTo(deg(4));
    expect(lookDelta(pose({ yawDeg: 2 }), pose({ yawDeg: 358 })).dYaw).toBeCloseTo(deg(-4));
  });

  it('keeps a delta of exactly ±180° on the same side', () => {
    expect(lookDelta(pose({ yawDeg: 0 }), pose({ yawDeg: 180 })).dYaw).toBe(0);
  });

  it('ignores an axis that jumps past the glitch threshold and keeps the other', () => {
    const jump = GLITCH_THRESHOLD_DEG + 1;
    expect(lookDelta(pose({ yawDeg: 100 }), pose({ yawDeg: 100 + jump, pitchDeg: -3 }))).toEqual({
      dYaw: 0,
      dPitch: expect.closeTo(deg(3)),
    });
    expect(lookDelta(pose({ pitchDeg: 0 }), pose({ pitchDeg: jump, yawDeg: 103 }))).toEqual({
      dYaw: expect.closeTo(deg(3)),
      dPitch: 0,
    });
  });

  it('accepts a delta exactly at the glitch threshold', () => {
    expect(lookDelta(pose({ yawDeg: 0 }), pose({ yawDeg: GLITCH_THRESHOLD_DEG })).dYaw).toBeCloseTo(
      deg(GLITCH_THRESHOLD_DEG),
    );
  });

  it('applies no delta across a screen-angle change', () => {
    expect(lookDelta(pose({ screenAngle: 0 }), pose({ screenAngle: 90, yawDeg: 105, pitchDeg: 5 }))).toEqual({
      dYaw: 0,
      dPitch: 0,
    });
  });
});
