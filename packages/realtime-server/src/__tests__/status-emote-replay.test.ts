import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActions, createBus, createStore, SyncEngine, type GameEvent, type PlayerId } from '@officexr/sdk';
import { RealtimeServer } from '../server.ts';
import { WsChannel } from '../ws-channel.ts';
import { EMOTE_BURST, EmoteRateLimit, EMOTE_WINDOW_MS } from '../emote-rate-limit.ts';

describe('status, hand and emotes through the server', () => {
  const cleanups: Array<() => unknown> = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0).reverse()) await c();
  });

  async function setup() {
    const server = new RealtimeServer({ port: 0 });
    await server.start();
    cleanups.push(() => server.stop());
    async function peer(userId: PlayerId) {
      const c = new WsChannel({ url: `ws://127.0.0.1:${server.boundPort}/ws`, userId, officeId: 'o1' });
      const store = createStore({ selfId: userId, officeId: 'o1' });
      const bus = createBus();
      const actions = createActions(store, bus);
      actions.upsertPlayer({ id: userId, pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0 });
      const sync = new SyncEngine({ store, actions, bus, channel: c, clock: { now: () => Date.now() } });
      const emotes: GameEvent[] = [];
      bus.on('emote:received', (e) => emotes.push(e));
      sync.start();
      await c.subscribe();
      c.trackPresence({});
      actions.upsertPlayer({ id: userId, name: `name-${userId}` });
      const close = () => {
        sync.stop();
        c.close();
      };
      cleanups.push(close);
      return { store, actions, sync, emotes, close };
    }
    return { server, peer };
  }

  it('shows a late joiner the status, focus flag and raised hand of a current player', async () => {
    const { peer } = await setup();
    const ann = await peer('ann');
    ann.actions.setSelfRichStatus({ statusText: 'In a review', statusEmoji: '🔍', focus: true });
    ann.actions.setSelfHand(true);
    await new Promise((r) => setTimeout(r, 100));

    const bob = await peer('bob');
    await vi.waitFor(() =>
      expect(bob.store.getState().players['ann']).toMatchObject({
        statusText: 'In a review',
        statusEmoji: '🔍',
        focus: true,
        handRaised: true,
      }),
    );
  });

  it('clears the hand and the status of a player who left, so a reload does not replay them', async () => {
    const { peer } = await setup();
    const ann1 = await peer('ann');
    ann1.actions.setSelfRichStatus({ statusText: 'Gone soon', focus: true });
    ann1.actions.setSelfHand(true);
    await new Promise((r) => setTimeout(r, 100));
    ann1.close();
    await new Promise((r) => setTimeout(r, 100));

    await peer('ann');
    const bob = await peer('bob');
    await vi.waitFor(() => expect(bob.store.getState().players['ann']).toBeDefined());
    expect(bob.store.getState().players['ann']?.handRaised ?? false).toBe(false);
    expect(bob.store.getState().players['ann']?.focus ?? false).toBe(false);
    expect(bob.store.getState().players['ann']?.statusText ?? null).toBeNull();
  });

  it('delivers an emote to the other peers and drops the sender beyond the burst limit', async () => {
    const { peer } = await setup();
    const ann = await peer('ann');
    const bob = await peer('bob');
    await new Promise((r) => setTimeout(r, 50));

    for (let i = 0; i < EMOTE_BURST + 3; i++) ann.sync.sendEmote('heart');
    await vi.waitFor(() => expect(bob.emotes).toHaveLength(EMOTE_BURST));
    await new Promise((r) => setTimeout(r, 100));

    expect(bob.emotes).toHaveLength(EMOTE_BURST);
    expect(bob.emotes[0]).toMatchObject({ kind: 'emote:received', fromId: 'ann', emote: 'heart' });
    expect(ann.emotes).toHaveLength(0);
  });
});

describe('EmoteRateLimit', () => {
  it('allows a burst, refuses the next, and allows again once the window has passed', () => {
    const limit = new EmoteRateLimit();
    const results = Array.from({ length: EMOTE_BURST + 1 }, () => limit.allow(1000));
    expect(results).toEqual([...Array(EMOTE_BURST).fill(true), false]);
    expect(limit.allow(1000 + EMOTE_WINDOW_MS - 1)).toBe(false);
    expect(limit.allow(1000 + EMOTE_WINDOW_MS)).toBe(true);
  });

  it('does not count refused emotes toward the window', () => {
    const limit = new EmoteRateLimit();
    for (let i = 0; i < EMOTE_BURST; i++) limit.allow(0);
    for (let i = 0; i < 50; i++) limit.allow(EMOTE_WINDOW_MS - 1);
    expect(limit.allow(EMOTE_WINDOW_MS)).toBe(true);
  });
});
