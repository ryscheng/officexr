import { describe, it, expect, vi } from 'vitest';
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
  const bus = createBus();
  const actions = createActions(store, bus);
  actions.upsertPlayer({ id: opts.selfId, name: opts.selfId });
  actions.upsertPlayer({ id: opts.remoteId, name: opts.remoteId });

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
      isAirborne: false,
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

  it('warns when a host-authoritative event arrives from a non-host actor', async () => {
    const ctx = setup({ selfId: 'me', remoteId: 'imposter' });
    // Designate a known host that ISN'T the imposter.
    ctx.actions.applyZombieState({
      phase: 'wave',
      wave: 1,
      totalKills: 0,
      hostId: 'real-host',
      entities: {},
      playerHealths: {},
    });
    await ctx.start();

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await ctx.remote.send({
        kind: 'zombie:state',
        v: 1,
        actorId: 'imposter',
        seq: 1,
        t: 0,
        state: {
          phase: 'wave',
          wave: 99,
          totalKills: 0,
          hostId: 'imposter',
          entities: {},
          playerHealths: {},
        },
      });
      // The lint logs but does NOT drop — the state is still applied.
      expect(ctx.store.getState().zombies.wave).toBe(99);
      expect(warnSpy).toHaveBeenCalled();
      const msg = warnSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(msg).toContain('zombie:state');
      expect(msg).toContain('imposter');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('does not warn when the host-authoritative event matches the current host', async () => {
    const ctx = setup({ selfId: 'me', remoteId: 'real-host' });
    ctx.actions.applyZombieState({
      phase: 'wave',
      wave: 1,
      totalKills: 0,
      hostId: 'real-host',
      entities: {},
      playerHealths: {},
    });
    await ctx.start();

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await ctx.remote.send({
        kind: 'zombie:state',
        v: 1,
        actorId: 'real-host',
        seq: 1,
        t: 0,
        state: {
          phase: 'wave',
          wave: 2,
          totalKills: 0,
          hostId: 'real-host',
          entities: {},
          playerHealths: {},
        },
      });
      expect(ctx.store.getState().zombies.wave).toBe(2);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('applies remote world:settings without re-broadcasting (no echo)', async () => {
    // Regression: an earlier refactor reordered `applyNetEventToStore`
    // and the anti-echo marker update so the marker landed AFTER the
    // store mutation. That made `subscribeAll → StateDiffBroadcaster`
    // see a "changed" worldSettings and fan the just-received event
    // back out — a cascade in a multi-peer mesh.
    const ctx = setup({ selfId: 'me', remoteId: 'other' });
    await ctx.start();
    const observer = new InMemoryChannel(ctx.hub, '__obs__');
    await observer.subscribe();
    const sent: NetEvent[] = [];
    observer.on((e) => sent.push(e));

    // The inbound event MUST differ from the local store's current
    // worldSettings — otherwise the diff would naturally not fire and
    // the test would pass for the wrong reason.
    const initial = ctx.store.getState().worldSettings;
    const changed = { ...initial, playerSpeed: initial.playerSpeed + 1.5 };
    await ctx.remote.send({
      kind: 'world:settings',
      v: 1,
      actorId: 'other',
      seq: 1,
      t: 0,
      settings: changed,
    });

    expect(ctx.store.getState().worldSettings.playerSpeed).toBe(
      changed.playerSpeed,
    );
    const echos = sent.filter(
      (e) => e.kind === 'world:settings' && e.actorId === 'me',
    );
    expect(echos).toHaveLength(0);
  });

  it('applies remote world:objects without re-broadcasting (no echo)', async () => {
    // Same regression shape as world:settings, but for the new
    // worldObjects broadcast slot (compiled scene snapshots).
    const ctx = setup({ selfId: 'me', remoteId: 'other' });
    await ctx.start();
    const observer = new InMemoryChannel(ctx.hub, '__obs__');
    await observer.subscribe();
    const sent: NetEvent[] = [];
    observer.on((e) => sent.push(e));

    const incoming = {
      cubeSize: 2,
      instances: [
        {
          id: 'cmd-1:0,0,0',
          sourceCommandId: 'cmd-1',
          kindId: 'colored_block_blue',
          position: [0, 0, 0] as [number, number, number],
        },
      ],
    };
    await ctx.remote.send({
      kind: 'world:objects',
      v: 1,
      actorId: 'other',
      seq: 1,
      t: 0,
      objects: incoming,
    });

    expect(ctx.store.getState().worldObjects).toEqual(incoming);
    const echos = sent.filter(
      (e) => e.kind === 'world:objects' && e.actorId === 'me',
    );
    expect(echos).toHaveLength(0);
  });

  it('applies remote world:characters without re-broadcasting (no echo)', async () => {
    // Same regression shape as world:settings, but for the new
    // characterConfigs broadcast slot.
    const ctx = setup({ selfId: 'me', remoteId: 'other' });
    await ctx.start();
    const observer = new InMemoryChannel(ctx.hub, '__obs__');
    await observer.subscribe();
    const sent: NetEvent[] = [];
    observer.on((e) => sent.push(e));

    const incoming = {
      Mage: { speedMultiplier: 0.5 },
      Knight: { charRadius: 0.55 },
    };
    await ctx.remote.send({
      kind: 'world:characters',
      v: 1,
      actorId: 'other',
      seq: 1,
      t: 0,
      configs: incoming,
    });

    expect(ctx.store.getState().characterConfigs).toEqual(incoming);
    const echos = sent.filter(
      (e) => e.kind === 'world:characters' && e.actorId === 'me',
    );
    expect(echos).toHaveLength(0);
  });

  it('applies remote world:map without re-broadcasting (no echo)', async () => {
    // Same regression shape as world:settings, but for the WorldMap
    // anti-echo marker.
    const ctx = setup({ selfId: 'me', remoteId: 'other' });
    await ctx.start();
    const observer = new InMemoryChannel(ctx.hub, '__obs__');
    await observer.subscribe();
    const sent: NetEvent[] = [];
    observer.on((e) => sent.push(e));

    const initial = ctx.store.getState().worldMap;
    const changed = { ...initial, gridSize: initial.gridSize + 4 };
    await ctx.remote.send({
      kind: 'world:map',
      v: 1,
      actorId: 'other',
      seq: 1,
      t: 0,
      map: changed,
    });

    expect(ctx.store.getState().worldMap.gridSize).toBe(changed.gridSize);
    const echos = sent.filter(
      (e) => e.kind === 'world:map' && e.actorId === 'me',
    );
    expect(echos).toHaveLength(0);
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
