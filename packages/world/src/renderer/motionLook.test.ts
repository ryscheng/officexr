import { describe, expect, it } from 'vitest';
import { DEG2RAD } from './lookControls.ts';
import { GLITCH_THRESHOLD_DEG, lookDelta, toPose, type MotionPose } from './motionLook.ts';

type Matrix = number[][];

const rotX = (deg: number): Matrix => {
  const [c, s] = [Math.cos(deg * DEG2RAD), Math.sin(deg * DEG2RAD)];
  return [[1, 0, 0], [0, c, -s], [0, s, c]];
};
const rotZ = (deg: number): Matrix => {
  const [c, s] = [Math.cos(deg * DEG2RAD), Math.sin(deg * DEG2RAD)];
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
};
const mul = (a: Matrix, b: Matrix): Matrix => a.map((row) => b[0].map((_, j) => row.reduce((sum, x, k) => sum + x * b[k][j], 0)));

/** The alpha/beta/gamma a browser reports for a device rotation matrix (W3C Z-X'-Y'' order). */
function readingOf(r: Matrix) {
  const sign = Math.sign(r[2][2]) || 1;
  const cosBeta = sign * Math.hypot(r[2][0], r[2][2]);
  return {
    alpha: (((Math.atan2(-r[0][1] / cosBeta, r[1][1] / cosBeta) / DEG2RAD) % 360) + 360) % 360,
    beta: Math.atan2(r[2][1], cosBeta) / DEG2RAD,
    gamma: Math.atan2(-r[2][0] / cosBeta, r[2][2] / cosBeta) / DEG2RAD,
  };
}

/**
 * A device whose back camera points `headingDeg` left of north and `upDeg`
 * above the horizon, rolled `rollDeg` about its screen normal (0 = portrait,
 * 90 = landscape, ...).
 */
const device = (headingDeg: number, upDeg: number, rollDeg: number) =>
  readingOf(mul(rotZ(headingDeg), mul(rotX(90 + upDeg), rotZ(rollDeg))));

const poseOf = (headingDeg: number, upDeg: number, rollDeg: number) => toPose(device(headingDeg, upDeg, rollDeg))!;

const deg = (d: number) => d * DEG2RAD;

const pose = (over: Partial<MotionPose> = {}): MotionPose => ({ yawDeg: 100, pitchDeg: 0, ...over });

describe('toPose', () => {
  it('has no pose without a full orientation reading', () => {
    expect(toPose({ alpha: null, beta: null, gamma: null })).toBeNull();
    expect(toPose({ alpha: 10, beta: 90, gamma: null })).toBeNull();
  });

  it('is unchanged by rolling the device about its screen normal', () => {
    const portrait = poseOf(25, 12, 0);
    for (const roll of [90, 180, 270]) {
      const rolled = poseOf(25, 12, roll);
      expect(rolled.yawDeg).toBeCloseTo(portrait.yawDeg, 6);
      expect(rolled.pitchDeg).toBeCloseTo(portrait.pitchDeg, 6);
    }
  });
});

describe.each([0, 90, 180, 270])('at a screen roll of %i°', (roll) => {
  const before = poseOf(0, -10, roll);

  it('turning right yields a negative yaw delta and no pitch', () => {
    const { dYaw, dPitch } = lookDelta(before, poseOf(-3, -10, roll));
    expect(dYaw).toBeCloseTo(deg(-3), 6);
    expect(dPitch).toBeCloseTo(0, 6);
  });

  it('tilting the back camera up yields a positive pitch delta and no yaw', () => {
    const { dYaw, dPitch } = lookDelta(before, poseOf(0, -7, roll));
    expect(dPitch).toBeCloseTo(deg(3), 6);
    expect(dYaw).toBeCloseTo(0, 6);
  });
});

describe('lookDelta', () => {
  it('accumulates no yaw or pitch while the device rolls from portrait to landscape', () => {
    let prev = poseOf(0, -10, 0);
    let yaw = 0;
    let pitch = 0;
    for (let roll = 5; roll <= 90; roll += 5) {
      const next = poseOf(0, -10, roll);
      const { dYaw, dPitch } = lookDelta(prev, next);
      yaw += dYaw;
      pitch += dPitch;
      prev = next;
    }
    expect(yaw).toBeCloseTo(0, 6);
    expect(pitch).toBeCloseTo(0, 6);
  });

  it('wraps yaw across 0/360 in both directions', () => {
    expect(lookDelta(pose({ yawDeg: 179 }), pose({ yawDeg: -179 })).dYaw).toBeCloseTo(deg(2));
    expect(lookDelta(pose({ yawDeg: -179 }), pose({ yawDeg: 179 })).dYaw).toBeCloseTo(deg(-2));
  });

  it('ignores an axis that jumps past the glitch threshold and keeps the other', () => {
    const jump = GLITCH_THRESHOLD_DEG + 1;
    expect(lookDelta(pose({ yawDeg: 0 }), pose({ yawDeg: jump, pitchDeg: 3 }))).toEqual({
      dYaw: 0,
      dPitch: expect.closeTo(deg(3)),
    });
    expect(lookDelta(pose({ yawDeg: 0, pitchDeg: 0 }), pose({ yawDeg: 3, pitchDeg: jump }))).toEqual({
      dYaw: expect.closeTo(deg(3)),
      dPitch: 0,
    });
  });

  it('accepts a jump exactly at the glitch threshold', () => {
    expect(lookDelta(pose({ yawDeg: 0 }), pose({ yawDeg: GLITCH_THRESHOLD_DEG })).dYaw).toBeCloseTo(
      deg(GLITCH_THRESHOLD_DEG),
    );
  });
});
