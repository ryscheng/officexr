import { describe, it, expect, beforeEach } from 'vitest';
import { createStore } from '../../game-state/store.ts';
import { createActions } from '../../game-state/actions.ts';
import { createBus } from '../../game-state/bus.ts';
import { SyncEngine, POSITION_CONSTANTS } from '../../realtime/sync.ts';
import {
  createInMemoryChannelHub,
  InMemoryChannel,
} from '../../realtime/channel.ts';
import { FakeClock } from '../../test-harness/time.ts';
import type { NetEvent } from '../../realtime/protocol.ts';

function setupOne(opts: { selfId: string }) {
  const hub = createInMemoryChannelHub();
  const store = createStore({ selfId: opts.selfId, officeId: 'r' });
  const actions = createActions(store);
  // seed self
  actions.upsertPlayer({
    id: opts.selfId,
    name: opts.selfId,
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    hp: 100,
    isDead: false,
    avatar: { model: 'default' },
    jitsiRoom: null,
    status: 'active',
  });
  const bus = createBus();
  const channel = new InMemoryChannel(hub, opts.selfId);
  const observer = new InMemoryChannel(hub, '__observer__');
  const clock = new FakeClock(0);
  const sent: NetEvent[] = [];
  const sync = new SyncEngine({ store, actions, bus, channel, clock });
  return {
    hub,
    store,
    actions,
    bus,
    channel,
    observer,
    clock,
    sync,
    sent,
    async start() {
      await observer.subscribe();
      observer.on((e) => sent.push(e));
      await channel.subscribe();
      sync.start();
    },
  };
}

describe('SyncEngine outbound — presence:position', () => {
  it('emits exactly one initial spawn packet, then nothing while idle', async () => {
    const ctx = setupOne({ selfId: 'me' });
    await ctx.start();
    // start() announces the spawn pose so peers can materialise the actor;
    // afterwards a stationary self should not produce more packets.
    ctx.sync.flushPosition();
    ctx.clock.advance(60_000); // a sim-minute
    ctx.sync.flushPosition();
    const positionPackets = ctx.sent.filter((e) => e.kind === 'presence:position');
    expect(positionPackets).toHaveLength(1);
    const initial = positionPackets[0] as Extract<
      NetEvent,
      { kind: 'presence:position' }
    >;
    expect(initial.vel).toEqual({ x: 0, y: 0, z: 0 });
    expect(initial.actorId).toBe('me');
  });

  it('sends a packet when self crosses the position delta threshold', async () => {
    const ctx = setupOne({ selfId: 'me' });
    await ctx.start();
    // exceed Δp
    ctx.actions.setSelfPosition(
      { x: POSITION_CONSTANTS.deltaP * 2, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      0,
      false,
    );
    ctx.sync.flushPosition();
    // Skip the initial spawn announcement (broadcast on start) — we're
    // measuring movement-driven packets here.
    const pkts = ctx.sent
      .filter((e) => e.kind === 'presence:position')
      .slice(1);
    expect(pkts).toHaveLength(1);
  });

  it('caps send rate at MAX_HZ', async () => {
    const ctx = setupOne({ selfId: 'me' });
    await ctx.start();
    let x = 0;
    // move every 1ms for 1 second; only ~MAX_HZ packets should send
    for (let ms = 0; ms < 1000; ms++) {
      x += POSITION_CONSTANTS.deltaP * 2;
      ctx.actions.setSelfPosition({ x, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 0, false);
      ctx.sync.flushPosition();
      ctx.clock.advance(1);
    }
    const pkts = ctx.sent.filter((e) => e.kind === 'presence:position');
    expect(pkts.length).toBeLessThanOrEqual(POSITION_CONSTANTS.maxHz + 1);
    expect(pkts.length).toBeGreaterThan(POSITION_CONSTANTS.maxHz / 2);
  });

  it('emits exactly one stop packet (vel=0) within STOP_GRACE_MS of stopping', async () => {
    const ctx = setupOne({ selfId: 'me' });
    await ctx.start();
    // walk
    for (let i = 0; i < 5; i++) {
      ctx.actions.setSelfPosition(
        { x: (i + 1) * POSITION_CONSTANTS.deltaP * 2, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        0,
        false,
      );
      ctx.clock.advance(50);
      ctx.sync.flushPosition();
    }
    // stop — set vel to 0 and stay put
    ctx.actions.setSelfPosition(
      { x: 5 * POSITION_CONSTANTS.deltaP * 2, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      0,
      false,
    );
    ctx.clock.advance(POSITION_CONSTANTS.stopGraceMs + 10);
    ctx.sync.flushPosition();
    // Skip the initial spawn announcement at the start of stream — we're
    // measuring the stop-detection emission only.
    const pkts = ctx.sent
      .filter((e) => e.kind === 'presence:position')
      .slice(1);
    const lastPkt = pkts[pkts.length - 1] as Extract<NetEvent, { kind: 'presence:position' }>;
    expect(lastPkt.vel).toEqual({ x: 0, y: 0, z: 0 });
    // only one stop packet (excluding the spawn baseline)
    const stops = pkts.filter((p) => {
      const pp = p as Extract<NetEvent, { kind: 'presence:position' }>;
      return pp.vel.x === 0 && pp.vel.y === 0 && pp.vel.z === 0;
    });
    expect(stops).toHaveLength(1);
  });

  it('seq is monotonic per actor', async () => {
    const ctx = setupOne({ selfId: 'me' });
    await ctx.start();
    for (let i = 0; i < 3; i++) {
      ctx.actions.appendChat({ id: `m${i}`, authorId: 'me', text: `x${i}`, t: 0 });
    }
    const seqs = ctx.sent
      .filter((e) => e.kind === 'chat:message')
      .map((e) => e.seq);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }
  });
});

describe('SyncEngine outbound — send-on-mutation kinds', () => {
  let ctx: ReturnType<typeof setupOne>;
  beforeEach(async () => {
    ctx = setupOne({ selfId: 'me' });
    await ctx.start();
  });

  it('chat:message sends immediately on mutation', () => {
    ctx.actions.appendChat({ id: 'm1', authorId: 'me', text: 'hi', t: 0 });
    expect(ctx.sent.find((e) => e.kind === 'chat:message')).toBeDefined();
  });

  it('whiteboard:stroke sends immediately on mutation', () => {
    ctx.actions.appendStroke({
      id: 's1',
      authorId: 'me',
      points: [{ x: 0, y: 0 }],
      color: '#000',
      width: 1,
      t: 0,
    });
    expect(ctx.sent.find((e) => e.kind === 'whiteboard:stroke')).toBeDefined();
  });

  it('world:characters sends on setCharacterConfig mutation', () => {
    ctx.actions.setCharacterConfig('Mage', { speedMultiplier: 0.7 });
    const evt = ctx.sent.find((e) => e.kind === 'world:characters');
    expect(evt).toBeDefined();
    if (evt && evt.kind === 'world:characters') {
      expect(evt.configs.Mage).toEqual({ speedMultiplier: 0.7 });
    }
  });

  it('world:objects sends on setWorldObjects mutation', () => {
    ctx.actions.setWorldObjects({
      cubeSize: 2,
      instances: [
        {
          id: 'i1',
          sourceCommandId: 'c1',
          kindId: 'colored_block_blue',
          position: [1, 0, 2],
        },
      ],
    });
    const evt = ctx.sent.find((e) => e.kind === 'world:objects');
    expect(evt).toBeDefined();
    if (evt && evt.kind === 'world:objects') {
      expect(evt.objects.instances).toHaveLength(1);
      expect(evt.objects.instances[0].kindId).toBe('colored_block_blue');
      expect(evt.objects.instances[0].position).toEqual([1, 0, 2]);
    }
  });
});
