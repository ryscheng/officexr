import { describe, expect, it } from 'vitest';
import { JOYSTICK_DEAD_ZONE, NO_MOVE, joystickVector } from './joystick.ts';

const R = 40;

describe('joystickVector', () => {
  it('is zero inside the dead zone and live just outside it', () => {
    expect(joystickVector(0, 0, R, JOYSTICK_DEAD_ZONE)).toEqual(NO_MOVE);
    expect(joystickVector(R * JOYSTICK_DEAD_ZONE * 0.9, 0, R, JOYSTICK_DEAD_ZONE)).toEqual(NO_MOVE);
    expect(joystickVector(R * JOYSTICK_DEAD_ZONE * 1.1, 0, R, JOYSTICK_DEAD_ZONE).x).toBeGreaterThan(0);
  });

  it('maps right to +x and up (negative screen y) to forward +z', () => {
    const right = joystickVector(R / 2, 0, R, 0);
    expect(right.x).toBeCloseTo(0.5);
    expect(right.z).toBeCloseTo(0);
    const up = joystickVector(0, -R / 2, R, 0);
    expect(up.x).toBe(0);
    expect(up.z).toBeCloseTo(0.5);
    const downLeft = joystickVector(-R / 4, R / 4, R, 0);
    expect(downLeft.x).toBeLessThan(0);
    expect(downLeft.z).toBeLessThan(0);
  });

  it('clamps beyond the radius to the unit circle, keeping the direction', () => {
    const v = joystickVector(3 * R, -4 * R, R, 0);
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(1);
    expect(v.x).toBeCloseTo(0.6);
    expect(v.z).toBeCloseTo(0.8);
  });

  it('keeps analog magnitude inside the circle', () => {
    const v = joystickVector(0.3 * R, 0, R, 0);
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(0.3);
  });
});
