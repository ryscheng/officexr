import { describe, expect, it } from 'vitest';
import { DEPARTED_LINGER_MS, UNRESPONSIVE_MS, presenceIndicator } from '../../game-state/presence.ts';
import { SyncEngine, type IntervalTimers } from '../../realtime/sync.ts';
import { createStore } from '../../game-state/store.ts';
import { createActions } from '../../game-state/actions.ts';
import { createBus } from '../../game-state/bus.ts';
import { InMemoryChannel, createInMemoryChannelHub } from '../../realtime/channel.ts';
import { FakeClock } from '../../test-harness/time.ts';
import { createMultiClientHarness } from '../../test-harness/two-client.ts';
import type { NetEvent } from '../../realtime/protocol.ts';

describe('presence heartbeat', () => {
  it('propagates setSelfPresence to peers', async () => {
    const h = createMultiClientHarness();
    const a = await h.add('a');
    const b = await h.add('b');

    a.actions.setSelfPresence({ status: 'away', mic: 'speaking' });

    expect(b.store.getState().players['a']).toMatchObject({ status: 'away', mic: 'speaking' });
  });

  it('re-sends every 5 s with no change, advancing lastStatusAt', async () => {
    const h = createMultiClientHarness();
    const b = await h.add('b');
    await h.add('a');
    const first = b.store.getState().players['a']!.lastStatusAt!;

    h.step(4_000);
    expect(b.store.getState().players['a']!.lastStatusAt).toBe(first);

    h.step(1_000);
    expect(b.store.getState().players['a']!.lastStatusAt).toBe(first + 5_000);
  });

  it('sends nothing while held, then announces on release', async () => {
    const h = createMultiClientHarness();
    const a = await h.add('a');
    const b = await h.add('b', { holdSelf: true });
    const fromB: NetEvent[] = [];
    a.channel.on((e) => {
      if (e.actorId === 'b') fromB.push(e);
    });

    b.actions.setSelfPresence({ mic: 'muted' });
    h.step(10_000);
    expect(fromB).toEqual([]);

    b.sync.releaseSelf();
    expect(fromB.map((e) => e.kind)).toContain('presence:status');
    expect(a.store.getState().players['b']?.mic).toBe('muted');
  });

  it('stamps firstSeenAt on first contact only', async () => {
    const h = createMultiClientHarness();
    h.clock.set(1_000);
    const b = await h.add('b');
    await h.add('a');
    h.step(5_000);

    expect(b.store.getState().players['a']!.firstSeenAt).toBe(1_000);
  });

  it('keeps a departed player for 60 s', async () => {
    const h = createMultiClientHarness();
    const b = await h.add('b');
    const a = await h.add('a');
    a.actions.upsertPlayer({ id: 'a', name: 'Alice' });

    h.remove('a');
    expect(b.store.getState().players['a']).toBeUndefined();
    expect(b.store.getState().departed['a']).toEqual({ name: 'Alice', leftAt: 0 });

    h.step(DEPARTED_LINGER_MS);
    expect(b.store.getState().departed['a']).toBeDefined();
    h.step(1);
    expect(b.store.getState().departed['a']).toBeUndefined();
  });

  it('records no departed entry for a peer that never announced', async () => {
    const h = createMultiClientHarness();
    const b = await h.add('b');
    await h.add('held', { seedSelf: false, holdSelf: true });

    h.remove('held');

    expect(b.store.getState().departed).toEqual({});
  });

  it('ages a snapshot-laid peer that never sends into unresponsive', async () => {
    const h = createMultiClientHarness();
    const a = await h.add('a');
    a.actions.upsertPlayer({ id: 'ghost', name: 'Ghost' });
    const b = await h.add('b');
    await b.handshake.requestSnapshot();
    expect(b.store.getState().players['ghost']).toBeDefined();

    const ghost = () => b.store.getState().players['ghost']!;
    h.step(UNRESPONSIVE_MS);
    expect(presenceIndicator(ghost(), h.clock.now())).toBe('available');
    h.step(1);
    expect(presenceIndicator(ghost(), h.clock.now())).toBe('unresponsive');
  });

  it('clears departed when the player rejoins', async () => {
    const h = createMultiClientHarness();
    const b = await h.add('b');
    await h.add('a');

    h.remove('a');
    expect(b.store.getState().departed['a']).toBeDefined();
    await h.add('a');
    expect(b.store.getState().departed['a']).toBeUndefined();
  });
});

describe('SyncEngine heartbeat timer', () => {
  it('starts on start(), drives the heartbeat, and is cleared on stop()', async () => {
    const hub = createInMemoryChannelHub();
    const store = createStore({ selfId: 'a', officeId: 'o' });
    const actions = createActions(store);
    actions.upsertPlayer({ id: 'a', name: 'a' });
    const clock = new FakeClock(0);
    const channel = new InMemoryChannel(hub, 'a');
    const observer = new InMemoryChannel(hub, 'observer');
    const sent: NetEvent[] = [];
    await observer.subscribe();
    await channel.subscribe();
    observer.on((e) => sent.push(e));

    let tick: (() => void) | null = null;
    const intervals: number[] = [];
    const cleared: unknown[] = [];
    const timers: IntervalTimers = {
      setInterval: (fn, ms) => {
        tick = fn;
        intervals.push(ms);
        return 'handle';
      },
      clearInterval: (h) => cleared.push(h),
    };
    const sync = new SyncEngine({ store, actions, bus: createBus(), channel, clock, timers });

    expect(intervals).toEqual([]);
    sync.start();
    expect(intervals).toHaveLength(1);

    const statusCount = () => sent.filter((e) => e.kind === 'presence:status').length;
    const afterStart = statusCount();
    clock.advance(5_000);
    tick!();
    expect(statusCount()).toBe(afterStart + 1);

    sync.stop();
    expect(cleared).toEqual(['handle']);
  });
});
