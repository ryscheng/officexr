import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActions, createBus, createStore, SyncEngine, type GameEvent, type PlayerId } from '@officexr/sdk';
import { RealtimeServer } from '../server.ts';
import { WsChannel } from '../ws-channel.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('status and emote replay across reconnects', () => {
  const cleanups: Array<() => unknown> = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0).reverse()) await c();
  });

  async function setup() {
    const server = new RealtimeServer({ port: 0 });
    await server.start();
    cleanups.push(() => server.stop());
    async function peer(userId: PlayerId, opts: { holdSelf?: boolean } = {}) {
      const c = new WsChannel({ url: `ws://127.0.0.1:${server.boundPort}/ws`, userId, officeId: 'o1' });
      const store = createStore({ selfId: userId, officeId: 'o1' });
      const bus = createBus();
      const actions = createActions(store, bus);
      actions.upsertPlayer({ id: userId, pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0 });
      const sync = new SyncEngine({ store, actions, bus, channel: c, clock: { now: () => Date.now() }, holdSelf: opts.holdSelf });
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
      return { store, actions, sync, emotes, close, channel: c };
    }
    return { server, peer };
  }

  it('a late joiner sees a hand lowered after it joined', async () => {
    const { peer } = await setup();
    // Four colleagues already in the office, each with a raised hand and a status.
    for (const id of ['p0', 'p1', 'p2', 'p3']) {
      const p = await peer(id);
      p.actions.setSelfRichStatus({ statusText: `busy ${id}` });
      p.actions.setSelfHand(true);
    }
    const ann = await peer('ann');
    ann.actions.setSelfRichStatus({ statusText: 'Question for the team' });
    ann.actions.setSelfHand(true);
    await sleep(150);

    const bob = await peer('bob');
    await vi.waitFor(() => expect(bob.store.getState().players['ann']?.handRaised).toBe(true));

    ann.actions.setSelfHand(false);
    ann.actions.setSelfRichStatus({ statusText: 'Answered, thanks' });
    await sleep(300);
    expect(bob.store.getState().players['ann']?.handRaised).toBe(false);
    expect(bob.store.getState().players['ann']?.statusText).toBe('Answered, thanks');
  });

  it('a reconnect does not reset the emote rate limit', async () => {
    const { peer } = await setup();
    const bob = await peer('bob');
    let ann = await peer('ann');
    await sleep(50);
    const t0 = Date.now();
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 4; i++) ann.sync.sendEmote('heart');
      await sleep(50);
      ann.close();
      await sleep(50);
      ann = await peer('ann');
      await sleep(50);
    }
    await sleep(100);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(4000);
    expect(bob.emotes.length).toBeLessThanOrEqual(4);
  });
  it('a replaced session: a late joiner does not see the old tab\'s raised hand', async () => {
    const { peer } = await setup();
    const ann1 = await peer('ann');
    const w = await peer('watcher');
    ann1.actions.setSelfHand(true);
    ann1.actions.setSelfPose('scooter', 'rack-7');
    await vi.waitFor(() => expect(w.store.getState().players['ann']?.handRaised).toBe(true));

    // Reload where the new socket says hello before the old one closed: the server replaces ann1.
    // Like the web client: the engine holds self until the map loads, then releaseSelf() announces it.
    const ann2 = await peer('ann', { holdSelf: true });
    await sleep(50);
    ann2.sync.releaseSelf();
    await sleep(200);

    const bob = await peer('bob');
    await vi.waitFor(() => expect(bob.store.getState().players['ann']).toBeDefined());
    await sleep(100);
    const a = bob.store.getState().players['ann'];
    expect(a?.pose ?? null).toBeNull();
    expect(a?.handRaised ?? false).toBe(false);
  });
});
