import { describe, it, expect } from 'vitest';
import { createMultiClientHarness } from '../../test-harness/two-client.ts';
import { POSITION_CONSTANTS } from '../../realtime/sync.ts';

describe('integration: presence-sync', () => {
  it('A walks; B receives the matching final position after A stops', async () => {
    const h = createMultiClientHarness();
    const A = await h.add('alice');
    const B = await h.add('bob');
    h.ensureMutualPresence();

    // Alice walks +x in 6 small steps over 300ms. Each step exceeds Δp.
    const stepDx = POSITION_CONSTANTS.deltaP * 2;
    let x = 0;
    for (let i = 0; i < 6; i++) {
      h.clock.advance(50);
      x += stepDx;
      A.actions.setSelfPosition({ x, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 0);
      h.flush();
    }

    // Alice stops: vel=0, pos doesn't change for STOP_GRACE_MS+
    A.actions.setSelfPosition({ x, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0);
    h.clock.advance(POSITION_CONSTANTS.stopGraceMs + 20);
    h.flush();

    // Bob's view of Alice should match Alice's final position within 1cm
    const bobAlice = B.store.getState().players['alice'];
    expect(bobAlice).toBeDefined();
    expect(Math.abs(bobAlice.pos.x - x)).toBeLessThan(0.01);
    // The last received vel is the stop packet
    expect(bobAlice.vel).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('a stationary client broadcasts no presence:position packets per simulated minute', async () => {
    const h = createMultiClientHarness();
    const A = await h.add('alice');
    await h.add('bob');
    h.ensureMutualPresence();

    // Observer subscribes via the hub to count broadcasts
    const { InMemoryChannel } = await import('../../realtime/channel.ts');
    const obs = new InMemoryChannel(h.hub, '__presence-obs__');
    await obs.subscribe();
    const positions: number[] = [];
    obs.on((e) => {
      if (e.kind === 'presence:position' && e.actorId === 'alice') {
        positions.push(e.t);
      }
    });

    // Advance one simulated minute, ticking flush every second
    for (let s = 0; s < 60; s++) {
      h.step(1000);
    }

    expect(positions).toHaveLength(0);
    // Reference A so it isn't "unused"
    expect(A.id).toBe('alice');
  });

  it('B does not overshoot A\'s stop point after a final stop packet', async () => {
    const h = createMultiClientHarness();
    const A = await h.add('alice');
    const B = await h.add('bob');
    h.ensureMutualPresence();

    // Alice walks 500ms then stops at x=2.5
    const stepDx = POSITION_CONSTANTS.deltaP * 2;
    let x = 0;
    for (let i = 0; i < 25; i++) {
      h.clock.advance(20);
      x += stepDx;
      A.actions.setSelfPosition({ x, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 0);
      h.flush();
    }
    const stopX = x;

    A.actions.setSelfPosition({ x: stopX, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0);
    h.clock.advance(POSITION_CONSTANTS.stopGraceMs + 5);
    h.flush();

    // After 500ms more, Bob's "displayPos" extrapolation = pos + vel*(now-tRecv)
    // Since vel was set to 0 by the stop packet, Bob does NOT overshoot.
    h.clock.advance(500);
    h.flush();
    const bobAlice = B.store.getState().players['alice'];
    expect(bobAlice.pos.x).toBeCloseTo(stopX, 2);
    expect(bobAlice.vel).toEqual({ x: 0, y: 0, z: 0 });
  });
});
