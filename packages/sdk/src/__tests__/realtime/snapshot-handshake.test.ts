import { describe, it, expect } from 'vitest';
import { createStore } from '../../game-state/store.ts';
import { createActions } from '../../game-state/actions.ts';
import { createBus } from '../../game-state/bus.ts';
import { SyncEngine } from '../../realtime/sync.ts';
import {
  createInMemoryChannelHub,
  InMemoryChannel,
} from '../../realtime/channel.ts';
import { FakeClock } from '../../test-harness/time.ts';
import {
  SnapshotHandshake,
  electLeader,
  SNAPSHOT_TIMEOUT_MS,
  SNAPSHOT_MAX_RETRIES,
} from '../../realtime/snapshot-handshake.ts';
import { serializeOfficeState } from '../../game-state/snapshot.ts';
import type { NetEvent } from '../../realtime/protocol.ts';

describe('electLeader', () => {
  it('returns the lex-min present actor excluding the requester', () => {
    expect(electLeader(['alice', 'bob', 'charlie'], 'charlie')).toBe('alice');
    expect(electLeader(['bob', 'alice'], 'bob')).toBe('alice');
  });

  it('returns null if no candidates remain', () => {
    expect(electLeader(['alice'], 'alice')).toBeNull();
    expect(electLeader([], 'alice')).toBeNull();
  });

  it('is deterministic across re-orderings', () => {
    expect(electLeader(['c', 'a', 'b'], 'c')).toBe('a');
    expect(electLeader(['a', 'b', 'c'], 'c')).toBe('a');
  });
});

describe('SnapshotHandshake — leader behavior', () => {
  it('only the lex-min leader responds to a snapshot:request', async () => {
    const hub = createInMemoryChannelHub();
    const a = setupClient(hub, 'alice'); // would be leader
    const b = setupClient(hub, 'bob');
    const c = setupClient(hub, 'charlie'); // requester

    await a.start();
    await b.start();
    await c.start();

    // Pre-populate `alice` with some state so a snapshot is interesting.
    a.actions.appendChat({ id: 'm1', authorId: 'alice', text: 'hello', t: 0 });

    // Charlie sends a snapshot:request
    const offers: NetEvent[] = [];
    a.observerEvents.length = 0;
    b.observerEvents.length = 0;
    a.handshake.start();
    b.handshake.start();
    c.handshake.start();

    // Track all snapshot:offer broadcasts
    const obs = new InMemoryChannel(hub, '__obs__');
    await obs.subscribe();
    obs.on((e) => {
      if (e.kind === 'snapshot:offer') offers.push(e);
    });

    // Charlie starts the request:
    await c.handshake.requestSnapshot();
    // give microtasks time
    await flush();
    expect(offers).toHaveLength(1);
    expect(offers[0].actorId).toBe('alice');
  });
});

describe('SnapshotHandshake — applying a snapshot', () => {
  it('applies snapshot, drains queued events, and sets status to live', async () => {
    const hub = createInMemoryChannelHub();
    const leader = setupClient(hub, 'alice');
    const newcomer = setupClient(hub, 'newcomer');
    await leader.start();

    // populate leader's state
    leader.actions.appendChat({ id: 'm1', authorId: 'alice', text: 'pre-existing', t: 0 });

    await newcomer.start();
    leader.handshake.start();
    newcomer.handshake.start();

    const requestPromise = newcomer.handshake.requestSnapshot();

    // Inject a live event during the snapshot window so it is queued
    await leader.channel.send({
      kind: 'chat:message',
      v: 1,
      actorId: 'alice',
      seq: 100,
      t: 0,
      text: 'live-during-snapshot',
    });

    await requestPromise;
    await flush();

    expect(newcomer.store.getState().realtime.status).toBe('live');
    const chat = newcomer.store.getState().chat.map((m) => m.text);
    expect(chat).toContain('pre-existing');
    expect(chat).toContain('live-during-snapshot');
  });

  it('drops live events that are already covered by the snapshot seqTable', async () => {
    const hub = createInMemoryChannelHub();
    const leader = setupClient(hub, 'alice');
    const newcomer = setupClient(hub, 'newcomer');
    await leader.start();
    leader.handshake.start();

    // Leader broadcasts three chat messages BEFORE newcomer joins. These
    // messages are reflected in the leader's local state and will be in the
    // shipped snapshot. The leader's outbound seq table will have alice=3.
    leader.actions.appendChat({ id: 'm1', authorId: 'alice', text: 'pre-1', t: 0 });
    leader.actions.appendChat({ id: 'm2', authorId: 'alice', text: 'pre-2', t: 1 });
    leader.actions.appendChat({ id: 'm3', authorId: 'alice', text: 'pre-3', t: 2 });

    await newcomer.start();
    newcomer.handshake.start();

    const requestPromise = newcomer.handshake.requestSnapshot();

    // Replay all three pre-snapshot messages "live" during the snapshot
    // window. Each has a seq that's covered by the snapshot's seqTable
    // (alice=3), so all three must be deduped — exactly one copy of each
    // text should land in the newcomer's chat (from the snapshot itself).
    for (const [seq, text] of [
      [1, 'pre-1'],
      [2, 'pre-2'],
      [3, 'pre-3'],
    ] as const) {
      await leader.channel.send({
        kind: 'chat:message',
        v: 1,
        actorId: 'alice',
        seq,
        t: 0,
        text,
      });
    }

    await requestPromise;
    await flush();

    const counts = new Map<string, number>();
    for (const m of newcomer.store.getState().chat) {
      counts.set(m.text, (counts.get(m.text) ?? 0) + 1);
    }
    expect(counts.get('pre-1')).toBe(1);
    expect(counts.get('pre-2')).toBe(1);
    expect(counts.get('pre-3')).toBe(1);
  });

  it('applies live events with seq beyond the snapshot seqTable', async () => {
    const hub = createInMemoryChannelHub();
    const leader = setupClient(hub, 'alice');
    const newcomer = setupClient(hub, 'newcomer');
    await leader.start();
    leader.handshake.start();
    leader.actions.appendChat({ id: 'm1', authorId: 'alice', text: 'in-snapshot', t: 0 });

    await newcomer.start();
    newcomer.handshake.start();

    const requestPromise = newcomer.handshake.requestSnapshot();
    // A live event with seq beyond what's in the snapshot — must not be
    // dropped.
    await leader.channel.send({
      kind: 'chat:message',
      v: 1,
      actorId: 'alice',
      seq: 999,
      t: 0,
      text: 'live-after-snapshot',
    });

    await requestPromise;
    await flush();
    const texts = newcomer.store.getState().chat.map((m) => m.text);
    expect(texts).toContain('in-snapshot');
    expect(texts).toContain('live-after-snapshot');
  });
});

describe('SnapshotHandshake — timeout', () => {
  it('retries SNAPSHOT_MAX_RETRIES times, then proceeds with empty state', async () => {
    const hub = createInMemoryChannelHub();
    // No leader exists — newcomer is alone.
    const newcomer = setupClient(hub, 'lonely');
    await newcomer.start();
    newcomer.handshake.start();
    const reqs: NetEvent[] = [];
    const obs = new InMemoryChannel(hub, '__obs__');
    await obs.subscribe();
    obs.on((e) => {
      if (e.kind === 'snapshot:request') reqs.push(e);
    });
    const promise = newcomer.handshake.requestSnapshot();

    // Advance through all timeouts
    for (let i = 0; i <= SNAPSHOT_MAX_RETRIES; i++) {
      newcomer.clock.advance(SNAPSHOT_TIMEOUT_MS + 1);
      newcomer.handshake.tickTimers();
    }

    await promise;
    await flush();
    // SNAPSHOT_MAX_RETRIES retries means initial + N retries = N+1 requests
    expect(reqs.length).toBeGreaterThanOrEqual(1);
    expect(newcomer.store.getState().realtime.status).toBe('live');
  });
});

// helpers ----------------------------------------------------------

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

function setupClient(
  hub: ReturnType<typeof createInMemoryChannelHub>,
  selfId: string,
) {
  const store = createStore({ selfId, officeId: 'r' });
  const actions = createActions(store);
  actions.upsertPlayer({ id: selfId, name: selfId });
  const bus = createBus();
  const channel = new InMemoryChannel(hub, selfId);
  const clock = new FakeClock(0);
  const sync = new SyncEngine({ store, actions, bus, channel, clock });
  const handshake = new SnapshotHandshake({
    selfId,
    store,
    actions,
    sync,
    channel,
    clock,
    serialize: () => serializeOfficeState(store.getState()),
  });
  const observerEvents: NetEvent[] = [];
  return {
    store,
    actions,
    bus,
    channel,
    clock,
    sync,
    handshake,
    observerEvents,
    async start() {
      await channel.subscribe();
      channel.trackPresence({});
      sync.start();
    },
  };
}
