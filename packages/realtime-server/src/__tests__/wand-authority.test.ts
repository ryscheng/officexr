import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createActions,
  createBus,
  createStore,
  HELD_DENIED_KIND,
  PROP_OP_KIND,
  SyncEngine,
  type NetEvent,
  type PlacedProp,
  type PlayerId,
  type PropOp,
} from '@officexr/sdk';
import type { PropsOutcome } from '../office-api.ts';
import { RealtimeServer } from '../server.ts';
import { WsChannel } from '../ws-channel.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('the server decides who holds the wand and who may cast', () => {
  const cleanups: Array<() => unknown> = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0).reverse()) await c();
  });

  function fakePropsApi() {
    let props: PlacedProp[] = [];
    let next = 1;
    return {
      listProps: async (): Promise<PropsOutcome> => ({ ok: true, props: [...props] }),
      propOp: async (_o: string, _l: string, op: PropOp): Promise<PropsOutcome> => {
        if (op.op === 'place') props = [...props, { id: `placed:${next++}`, kindId: op.kindId, position: op.position, yawDeg: op.yawDeg }];
        else if (op.op === 'remove') props = props.filter((p) => p.id !== op.id);
        return { ok: true, props: [...props] };
      },
    };
  }

  async function setup() {
    const server = new RealtimeServer({ port: 0, placedProps: fakePropsApi() });
    await server.start();
    cleanups.push(() => server.stop());
    async function peer(userId: PlayerId) {
      const channel = new WsChannel({ url: `ws://127.0.0.1:${server.boundPort}/ws`, userId, officeId: 'o1' });
      const events: NetEvent[] = [];
      let denied = 0;
      channel.on((e) => events.push(e));
      const store = createStore({ selfId: userId, officeId: 'o1' });
      const bus = createBus();
      const actions = createActions(store, bus);
      actions.upsertPlayer({ id: userId, pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0 });
      channel.onCustom(HELD_DENIED_KIND, () => {
        denied++;
        actions.setSelfHeld(null);
      });
      const sync = new SyncEngine({ store, actions, bus, channel, clock: { now: () => Date.now() } });
      sync.start();
      await channel.subscribe();
      channel.trackPresence({});
      actions.upsertPlayer({ id: userId, name: `name-${userId}` });
      const close = () => {
        sync.stop();
        channel.close();
      };
      cleanups.push(close);
      return { channel, events, store, actions, sync, close, denied: () => denied };
    }
    async function placeStand(by: Awaited<ReturnType<typeof peer>>) {
      by.channel.sendCustom(PROP_OP_KIND, { op: 'place', kindId: 'prop_wand_stand', position: [2, 0, 2], yawDeg: 0 });
      await vi.waitFor(() => expect(by.store.getState().placedProps.length).toBeGreaterThan(0));
      return by.store.getState().placedProps.at(-1)!.id;
    }
    return { server, peer, placeStand };
  }

  const cast = { spell: 'fireball' as const, origin: { x: 0, y: 1, z: 0 }, dir: { x: 0, y: 0, z: 1 }, distance: 4, targetId: 'bob' };
  const castsSeenBy = (p: { channel: WsChannel }) => {
    const seen: NetEvent[] = [];
    p.channel.on((e) => e.kind === 'spell:cast' && seen.push(e));
    return seen;
  };

  it('lets only the first of two simultaneous pick-ups keep the stand wand, and tells the loser to drop it', async () => {
    const { peer, placeStand } = await setup();
    const ann = await peer('ann');
    const bob = await peer('bob');
    const stand = await placeStand(ann);
    ann.actions.setSelfHeld('wand', stand);
    bob.actions.setSelfHeld('wand', stand);
    await sleep(250);
    const late = await peer('late');
    await sleep(150);
    const holders = Object.values(late.store.getState().players).filter((p) => p.heldStand === stand);
    expect(holders).toHaveLength(1);
    const loser = holders[0]!.id === 'ann' ? bob : ann;
    expect(loser.denied()).toBe(1);
  });

  it('keeps the cast cooldown across a reconnect', async () => {
    const { peer, placeStand } = await setup();
    const bob = await peer('bob');
    const seen = castsSeenBy(bob);
    let ann = await peer('ann');
    const stand = await placeStand(ann);
    ann.actions.setSelfHeld('wand', stand);
    await vi.waitFor(() => expect(bob.store.getState().players['ann']?.held).toBe('wand'));
    ann.sync.sendCast(cast);
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    ann.close();
    await sleep(30);
    ann = await peer('ann');
    ann.actions.setSelfHeld('wand', stand);
    await sleep(50);
    ann.sync.sendCast(cast);
    await sleep(200);
    expect(seen).toHaveLength(1);
  });

  it('ignores a presence:held that claims to come from another player', async () => {
    const { peer, placeStand } = await setup();
    const ann = await peer('ann');
    const bob = await peer('bob');
    const watcher = await peer('watcher');
    const stand = await placeStand(ann);
    bob.actions.setSelfHeld('wand', stand);
    await vi.waitFor(() => expect(watcher.store.getState().players['bob']?.held).toBe('wand'));
    await ann.channel.send({ kind: 'presence:held', v: 1, actorId: 'bob', seq: 9_000_000_000_000, t: Date.now(), held: null, stand: null } as NetEvent);
    await sleep(150);
    const seen = castsSeenBy(watcher);
    bob.sync.sendCast({ ...cast, targetId: 'watcher' });
    await sleep(200);
    expect(watcher.store.getState().players['bob']?.held).toBe('wand');
    expect(seen).toHaveLength(1);
  });

  it('refuses a cast from a wand that came from no stand, or from a stand that is not there', async () => {
    const { peer } = await setup();
    const ann = await peer('ann');
    const bob = await peer('bob');
    const seen = castsSeenBy(bob);
    ann.actions.setSelfHeld('wand', null);
    await sleep(100);
    ann.sync.sendCast(cast);
    ann.actions.setSelfHeld('wand', 'placed:404');
    await sleep(100);
    ann.sync.sendCast(cast);
    await sleep(150);
    expect(seen).toHaveLength(0);
    expect(ann.denied()).toBeGreaterThan(0);
  });

  it('turns a cast at someone who is not in the room into a miss, with no effect replayed', async () => {
    const { peer, placeStand } = await setup();
    const ann = await peer('ann');
    const bob = await peer('bob');
    const stand = await placeStand(ann);
    ann.actions.setSelfHeld('wand', stand);
    await sleep(100);
    const seen = castsSeenBy(bob);
    ann.sync.sendCast({ ...cast, targetId: 'ghost-not-in-room' });
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect((seen[0] as { targetId: string | null }).targetId).toBeNull();
    const late = await peer('late');
    await sleep(100);
    expect(Object.keys(late.store.getState().spellEffects)).not.toContain('ghost-not-in-room');
  });

  it('refuses a cast while riding or swimming', async () => {
    const { peer, placeStand } = await setup();
    const ann = await peer('ann');
    const bob = await peer('bob');
    const stand = await placeStand(ann);
    ann.actions.setSelfHeld('wand', stand);
    const seen = castsSeenBy(bob);
    ann.actions.setSelfPose('swim');
    await vi.waitFor(() => expect(bob.store.getState().players['ann']?.pose).toBe('swim'));
    ann.sync.sendCast(cast);
    await sleep(150);
    expect(seen).toHaveLength(0);
  });

  it('still relays a cast sent in the same breath as the pick-up', async () => {
    const { peer, placeStand } = await setup();
    const ann = await peer('ann');
    const bob = await peer('bob');
    const stand = await placeStand(ann);
    const seen = castsSeenBy(bob);
    ann.actions.setSelfHeld('wand', stand);
    ann.sync.sendCast(cast);
    await sleep(200);
    expect(seen).toHaveLength(1);
  });

  it('takes the wand from its holder when the stand is removed, for the holder, everyone and late joiners', async () => {
    const { peer, placeStand } = await setup();
    const ann = await peer('ann');
    const bob = await peer('bob');
    const stand = await placeStand(bob);
    ann.actions.setSelfHeld('wand', stand);
    await vi.waitFor(() => expect(bob.store.getState().players['ann']?.heldStand).toBe(stand));
    bob.channel.sendCustom(PROP_OP_KIND, { op: 'remove', id: stand });
    await vi.waitFor(() => expect(ann.store.getState().players['ann']?.held ?? null).toBeNull());
    await vi.waitFor(() => expect(bob.store.getState().players['ann']?.held ?? null).toBeNull());
    const seen = castsSeenBy(bob);
    ann.sync.sendCast(cast);
    await sleep(150);
    expect(seen).toHaveLength(0);
    const late = await peer('late');
    await sleep(100);
    expect(late.store.getState().players['ann']?.held ?? null).toBeNull();
  });
});
