import { describe, expect, it } from 'vitest';
import type { FootprintRect, PlayerId } from '@officexr/sdk';
import { yawFromDirection } from '../renderer/lookControls.ts';
import { GhostController, GHOST_FORWARD, type GhostKeys } from './ghost-controller.ts';

type P = { pos: { x: number; y: number; z: number }; yaw: number };
const TUN = { playerSpeed: 2, charRadius: 0.5, proximityRadius: 3 };
const none: GhostKeys = { forward: false, back: false, left: false, right: false };

function setup(footprint: FootprintRect[] = [], at = { x: 0, z: 0 }) {
  const players: Record<string, P> = { me: { pos: { x: at.x, y: 1.5, z: at.z }, yaw: 0 } };
  const actions = {
    setSelfPosition(pos: P['pos'], _vel: unknown, yaw: number, airborne: boolean) {
      expect(airborne).toBe(false);
      players.me = { pos, yaw };
    },
  };
  const store = { getState: () => ({ players }) };
  const c = new GhostController(
    actions,
    store as never,
    'me' as PlayerId,
    footprint,
    () => TUN,
  );
  return { c, players };
}
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

describe('GhostController', () => {
  it('walks at speed; forward is -Z; diagonals are normalized', () => {
    const { c, players } = setup();
    c.setKeys({ ...none, forward: true });
    c.step(1);
    expect(players.me.pos.z).toBeCloseTo(-2);
    expect(GHOST_FORWARD.z).toBe(-1);
    c.setKeys({ ...none, right: true, back: true });
    c.step(1);
    expect(dist(players.me.pos, { x: 0, z: -2 })).toBeCloseTo(2);
    expect(players.me.pos.y).toBe(1.5);
  });

  it('yaw matches yawFromDirection', () => {
    const { c, players } = setup();
    c.setKeys({ ...none, right: true });
    c.step(0.1);
    expect(players.me.yaw).toBe(yawFromDirection({ x: 1, z: 0 }));
  });

  it('slides around another player and never overlaps', () => {
    const { c, players } = setup([], { x: 0, z: 5 });
    players.other = { pos: { x: 0.2, y: 0, z: 0 }, yaw: 0 };
    c.setKeys({ ...none, forward: true });
    for (let i = 0; i < 100; i++) {
      c.step(0.05);
      expect(dist(players.me.pos, players.other.pos)).toBeGreaterThanOrEqual(1 - 1e-9);
    }
    expect(players.me.pos.z).toBeLessThan(0);
  });

  it('is never shoved when overlapped', () => {
    const { c, players } = setup();
    players.other = { pos: { x: 0.3, y: 0, z: 0 }, yaw: 0 };
    c.step(0.1);
    expect(players.me.pos.x).toBe(0);
    c.setKeys({ ...none, right: true });
    c.step(0.1);
    expect(dist(players.me.pos, players.other.pos)).toBeGreaterThanOrEqual(0.3 - 1e-9);
  });

  it('stays in the footprint and snaps in on spawn', () => {
    const fp = [{ min: { x: 0, z: 0 }, max: { x: 10, z: 10 } }];
    const { c, players } = setup(fp, { x: -5, z: 5 });
    c.step(0.016);
    expect(players.me.pos.x).toBe(0);
    c.setKeys({ ...none, left: true });
    c.step(1);
    expect(players.me.pos.x).toBe(0);
  });

  it('moveTo arrives and stops', () => {
    const { c, players } = setup();
    c.moveTo({ x: 3, z: 0 });
    for (let i = 0; i < 10; i++) {
      c.step(0.5);
    }
    expect(players.me.pos.x).toBeCloseTo(3);
    c.step(0.5);
    expect(players.me.pos.x).toBeCloseTo(3);
  });

  it('goTo follows a moving target and stops at proximity range', () => {
    const { c, players } = setup();
    players.other = { pos: { x: 10, y: 0, z: 0 }, yaw: 0 };
    c.goTo('other' as PlayerId);
    c.step(1);
    players.other.pos = { x: 10, y: 0, z: 10 };
    for (let i = 0; i < 20; i++) {
      c.step(1);
    }
    expect(dist(players.me.pos, players.other.pos)).toBeCloseTo(TUN.proximityRadius);
  });

  it('key input cancels auto-moves', () => {
    const { c, players } = setup();
    c.moveTo({ x: 10, z: 0 });
    c.setKeys({ ...none, back: true });
    c.setKeys(none);
    c.step(1);
    expect(players.me.pos.x).toBe(0);
  });
});
