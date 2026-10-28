import { describe, expect, it } from 'vitest';
import { NO_MOVE, moveIntent } from './moveIntent.ts';

const keys = (...k: string[]) => new Set(k);

describe('moveIntent', () => {
  it('reads WASD and arrow keys as full-speed intent', () => {
    expect(moveIntent(keys('w', 'd'), undefined)).toEqual({ fwd: 1, strafe: 1, isRunning: false, speedScale: 1 });
    expect(moveIntent(keys('arrowdown', 'arrowleft'), undefined)).toMatchObject({ fwd: -1, strafe: -1 });
  });

  it('lets held movement keys override the stick', () => {
    const intent = moveIntent(keys('w'), { x: 1, z: -1 });
    expect(intent).toEqual({ fwd: 1, strafe: 0, isRunning: false, speedScale: 1 });
  });

  it('takes direction and speed from the stick when no movement key is held', () => {
    const intent = moveIntent(keys(), { x: 0.3, z: 0.4 });
    expect(intent.strafe).toBe(0.3);
    expect(intent.fwd).toBe(0.4);
    expect(intent.speedScale).toBeCloseTo(0.5);
    expect(intent.isRunning).toBe(false);
  });

  it('runs on Shift with the stick, but still scales speed by deflection', () => {
    const intent = moveIntent(keys('shift'), { x: 0.3, z: 0.4 });
    expect(intent.isRunning).toBe(true);
    expect(intent.speedScale).toBeCloseTo(0.5);
  });

  it('walks at 0.89 deflection and runs at 0.9', () => {
    expect(moveIntent(keys(), { x: 0, z: 0.89 }).isRunning).toBe(false);
    expect(moveIntent(keys(), { x: 0, z: 0.9 }).isRunning).toBe(true);
  });

  it('ignores a missing or neutral stick', () => {
    const idle = { fwd: 0, strafe: 0, isRunning: false, speedScale: 1 };
    expect(moveIntent(keys(), undefined)).toEqual(idle);
    expect(moveIntent(keys(), NO_MOVE)).toEqual(idle);
    expect(moveIntent(keys('shift'), NO_MOVE)).toEqual({ ...idle, isRunning: true });
  });
});
