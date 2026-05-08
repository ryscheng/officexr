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
import type { NetEvent } from '../../realtime/protocol.ts';
import type { GameEvent } from '../../game-state/types.ts';

function setup(opts: { selfId: string; remoteId: string }) {
  const hub = createInMemoryChannelHub();

  const store = createStore({ selfId: opts.selfId, officeId: 'r' });
  const actions = createActions(store);
  actions.upsertPlayer({ id: opts.selfId, name: opts.selfId });
  actions.upsertPlayer({ id: opts.remoteId, name: opts.remoteId });

  const bus = createBus();
  const channel = new InMemoryChannel(hub, opts.selfId);
  const remote = new InMemoryChannel(hub, opts.remoteId);
  const clock = new FakeClock(0);
  const sync = new SyncEngine({ store, actions, bus, channel, clock });

  const versionWarnings: GameEvent[] = [];
  bus.on('realtime:version-warning', (e) => versionWarnings.push(e));

  return {
    hub,
    store,
    actions,
    bus,
    channel,
    remote,
    clock,
    sync,
    versionWarnings,
    async start() {
      await channel.subscribe();
      await remote.subscribe();
      sync.start();
    },
  };
}

describe('SyncEngine inbound', () => {
  it('applies presence:position events to the remote player slice', async () => {
    const ctx = setup({ selfId: 'me', remoteId: 'other' });
    await ctx.start();
    ctx.clock.set(1000);
    const evt: NetEvent = {
      kind: 'presence:position',
      v: 1,
      actorId: 'other',
      seq: 1,
      t: 100,
      pos: { x: 5, y: 0, z: 5 },
      vel: { x: 1, y: 0, z: 0 },
      yaw: 0.5,
    };
    await ctx.remote.send(evt);
    const r = ctx.store.getState().players['other'];
    expect(r.pos).toEqual({ x: 5, y: 0, z: 5 });
    expect(r.vel).toEqual({ x: 1, y: 0, z: 0 });
    expect(r.yaw).toBe(0.5);
    expect(r.tRecv).toBe(1000);
  });

  it('dedupes events by (actorId, seq)', async () => {
    const ctx = setup({ selfId: 'me', remoteId: 'other' });
    await ctx.start();
    const evt: NetEvent = {
      kind: 'chat:message',
      v: 1,
      actorId: 'other',
      seq: 5,
      t: 0,
      text: 'hi',
    };
    await ctx.remote.send(evt);
    await ctx.remote.send(evt);
    expect(ctx.store.getState().chat).toHaveLength(1);
  });

  it('drops events whose seq is older than the latest seen for that actor', async () => {
    const ctx = setup({ selfId: 'me', remoteId: 'other' });
    await ctx.start();
    await ctx.remote.send({
      kind: 'chat:message',
      v: 1,
      actorId: 'other',
      seq: 5,
      t: 0,
      text: 'newer',
    });
    await ctx.remote.send({
      kind: 'chat:message',
      v: 1,
      actorId: 'other',
      seq: 3,
      t: 0,
      text: 'older',
    });
    const chat = ctx.store.getState().chat;
    expect(chat.map((m) => m.text)).toEqual(['newer']);
  });

  it('drops invalid (Zod-failing) payloads silently', async () => {
    const ctx = setup({ selfId: 'me', remoteId: 'other' });
    await ctx.start();
    const bad = {
      kind: 'chat:message',
      v: 1,
      actorId: 'other',
      seq: 1,
      t: 0,
      text: 12345,
    } as unknown as NetEvent;
    await ctx.remote.send(bad);
    expect(ctx.store.getState().chat).toHaveLength(0);
  });

  it('emits realtime:version-warning exactly once per kind on version mismatch', async () => {
    const ctx = setup({ selfId: 'me', remoteId: 'other' });
    await ctx.start();
    const mk = (text: string): NetEvent =>
      ({
        kind: 'chat:message',
        v: 999,
        actorId: 'other',
        seq: Math.random(),
        t: 0,
        text,
      } as unknown as NetEvent);
    await ctx.remote.send(mk('a'));
    await ctx.remote.send(mk('b'));
    expect(ctx.versionWarnings).toHaveLength(1);
    expect((ctx.versionWarnings[0] as any).eventKind).toBe('chat:message');
    // valid events still flow
    await ctx.remote.send({
      kind: 'chat:message',
      v: 1,
      actorId: 'other',
      seq: 1,
      t: 0,
      text: 'ok',
    });
    expect(ctx.store.getState().chat.map((m) => m.text)).toEqual(['ok']);
  });

  it('routes shot:hit through applyHit and emits combat:hit on the bus', async () => {
    const ctx = setup({ selfId: 'me', remoteId: 'shooter' });
    ctx.actions.upsertPlayer({ id: 'me', hp: 100 });
    await ctx.start();
    const hits: GameEvent[] = [];
    ctx.bus.on('combat:hit', (e) => hits.push(e));
    await ctx.remote.send({
      kind: 'shot:hit',
      v: 1,
      actorId: 'shooter',
      seq: 1,
      t: 0,
      targetId: 'me',
      dmg: 25,
    });
    expect(ctx.store.getState().players['me'].hp).toBe(75);
    expect(hits).toHaveLength(1);
  });

  it('applies whiteboard:stroke without re-broadcasting (no echo)', async () => {
    const ctx = setup({ selfId: 'me', remoteId: 'other' });
    await ctx.start();
    const sentEcho: NetEvent[] = [];
    // observe what `me` sends back
    const observer = new InMemoryChannel(ctx.hub, '__obs__');
    await observer.subscribe();
    observer.on((e) => sentEcho.push(e));

    await ctx.remote.send({
      kind: 'whiteboard:stroke',
      v: 1,
      actorId: 'other',
      seq: 1,
      t: 0,
      stroke: {
        id: 's1',
        authorId: 'other',
        points: [{ x: 0, y: 0 }],
        color: '#000',
        width: 1,
        t: 0,
      },
    });
    expect(ctx.store.getState().whiteboard.strokes).toHaveLength(1);
    // the only stroke event observer saw is the original from `other`,
    // not an echo from `me`
    const strokeEvents = sentEcho.filter((e) => e.kind === 'whiteboard:stroke');
    expect(strokeEvents).toHaveLength(1);
    expect(strokeEvents[0].actorId).toBe('other');
  });
});
