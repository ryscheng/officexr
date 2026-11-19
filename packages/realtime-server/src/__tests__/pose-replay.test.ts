import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActions, createBus, createStore, SyncEngine, type NetEvent, type PlayerId } from '@officexr/sdk';
import { RealtimeServer } from '../server.ts';
import { WsChannel } from '../ws-channel.ts';

describe('pose replay to late joiners', () => {
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
      const events: NetEvent[] = [];
      c.on((e) => events.push(e));
      const store = createStore({ selfId: userId, officeId: 'o1' });
      const bus = createBus();
      const actions = createActions(store, bus);
      actions.upsertPlayer({ id: userId, pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0 });
      const sync = new SyncEngine({ store, actions, bus, channel: c, clock: { now: () => Date.now() } });
      sync.start();
      await c.subscribe();
      c.trackPresence({});
      actions.upsertPlayer({ id: userId, name: `name-${userId}` });
      const close = () => {
        sync.stop();
        c.close();
      };
      cleanups.push(close);
      return { c, events, store, actions, close };
    }
    return { server, peer };
  }

  it('does not show a stale ride after the rider reloads on foot', async () => {
    const { peer } = await setup();
    const ann1 = await peer('ann');
    const w = await peer('watcher');
    ann1.actions.setSelfPose('scooter', 'rack-7');
    await vi.waitFor(() => expect(w.store.getState().players['ann']?.pose).toBe('scooter'));
    ann1.close();
    await vi.waitFor(() => expect(w.store.getState().players['ann']).toBeUndefined());

    await peer('ann');
    await vi.waitFor(() => expect(w.store.getState().players['ann']).toBeDefined());

    const bob = await peer('bob');
    await vi.waitFor(() => expect(bob.store.getState().players['ann']).toBeDefined());
    const ann = bob.store.getState().players['ann'];
    expect([ann?.pose ?? null, ann?.poseRack ?? null]).toEqual([null, null]);
  });

  it('does not show a seat a player left before reloading', async () => {
    const { peer } = await setup();
    const ann1 = await peer('ann');
    ann1.actions.setSelfSeat('chair-1');
    await new Promise((r) => setTimeout(r, 100));
    ann1.close();
    await new Promise((r) => setTimeout(r, 100));
    await peer('ann');
    const bob = await peer('bob');
    await vi.waitFor(() => expect(bob.store.getState().players['ann']).toBeDefined());
    expect(bob.store.getState().players['ann']?.seat ?? null).toBeNull();
  });

  it('shows a current rider to a late joiner', async () => {
    const { peer } = await setup();
    const ann = await peer('ann');
    ann.actions.setSelfPose('tricycle', 'rack-2');
    await new Promise((r) => setTimeout(r, 100));
    const bob = await peer('bob');
    await vi.waitFor(() => expect(bob.store.getState().players['ann']).toMatchObject({ pose: 'tricycle', poseRack: 'rack-2' }));
  });
});
