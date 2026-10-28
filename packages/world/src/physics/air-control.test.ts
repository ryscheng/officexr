import { describe, it, expect } from 'vitest';
import { stepAirVelocity } from './air-control.ts';

const start = { x: 6, z: -3 };
const intent = { x: -2, z: 5 };

describe('stepAirVelocity', () => {
  it('snaps to intent when airControl is 1', () => {
    expect(stepAirVelocity(start, intent, 1, 1 / 60)).toEqual(intent);
  });

  it('keeps the current velocity when airControl is 0', () => {
    expect(stepAirVelocity(start, intent, 0, 1 / 60)).toEqual(start);
  });

  it('keeps the current velocity when dtSec is 0', () => {
    expect(stepAirVelocity(start, intent, 0.5, 0)).toEqual(start);
  });

  it('is frame-rate independent: one 1/30 step equals two 1/60 steps', () => {
    const once = stepAirVelocity(start, intent, 0.2, 1 / 30);
    const twice = stepAirVelocity(stepAirVelocity(start, intent, 0.2, 1 / 60), intent, 0.2, 1 / 60);
    expect(once.x).toBeCloseTo(twice.x, 9);
    expect(once.z).toBeCloseTo(twice.z, 9);
  });

  it('closes at least 90% of the gap within 0.25 s at airControl 0.2', () => {
    let v = start;
    for (let i = 0; i < 15; i++) {
      v = stepAirVelocity(v, intent, 0.2, 1 / 60);
    }
    expect(Math.abs(v.x - intent.x)).toBeLessThanOrEqual(0.1 * Math.abs(start.x - intent.x));
    expect(Math.abs(v.z - intent.z)).toBeLessThanOrEqual(0.1 * Math.abs(start.z - intent.z));
  });
});
