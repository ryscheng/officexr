import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createActions,
  createBus,
  createStore,
  PROP_OP_KIND,
  PROP_OP_RESULT_KIND,
  SPELL_COOLDOWN_MS,
  SyncEngine,
  type NetEvent,
  type PlacedProp,
  type PlayerId,
  type PropOp,
  type PropOpResult,
} from '@officexr/sdk';
import type { PropsOutcome } from '../office-api.ts';
import { RealtimeServer } from '../server.ts';
import { SpellCastGuard } from '../spell-guard.ts';
import { WsChannel } from '../ws-channel.ts';

function fakePropsApi() {
  let props: PlacedProp[] = [];
  let next = 1;
  const calls: PropOp[] = [];
  const outcome = (): PropsOutcome => ({ ok: true, props: [...props] });
  return {
    calls,
    listProps: async (): Promise<PropsOutcome> => outcome(),
    propOp: async (_office: string, _login: string, op: PropOp): Promise<PropsOutcome> => {
      calls.push(op);
      if (op.op === 'place') {
        if (props.length >= 2) return { ok: false, error: 'limit' };
        props = [...props, { id: `placed:${next++}`, kindId: op.kindId, position: op.position, yawDeg: op.yawDeg }];
      } else if (op.op === 'remove') {
        if (!props.some((p) => p.id === op.id)) return { ok: false, error: 'not-found' };
        props = props.filter((p) => p.id !== op.id);
      }
      return outcome();
    },
  };
}

describe('placed props, wand and spells through the realtime server', () => {
  const cleanups: Array<() => unknown> = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0).reverse()) await c();
  });

  async function setup(api = fakePropsApi()) {
    const server = new RealtimeServer({ port: 0, placedProps: api });
    await server.start();
    cleanups.push(() => server.stop());
    async function peer(userId: PlayerId) {
      const channel = new WsChannel({ url: `ws://127.0.0.1:${server.boundPort}/ws`, userId, officeId: 'o1' });
      const events: NetEvent[] = [];
      const results: PropOpResult[] = [];
      channel.on((e) => events.push(e));
      channel.onCustom(PROP_OP_RESULT_KIND, (p) => results.push(p as PropOpResult));
      const store = createStore({ selfId: userId, officeId: 'o1' });
      const bus = createBus();
      const actions = createActions(store, bus);
      actions.upsertPlayer({ id: userId, pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0 });
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
      const op = (body: unknown) => channel.sendCustom(PROP_OP_KIND, body);
      return { channel, events, results, store, actions, sync, close, op };
    }
    return { server, peer, api };
  }

  const pool = { op: 'place', kindId: 'prop_pool', position: [4, 4, 6], yawDeg: 0 };
  const propsIn = (events: NetEvent[]) => events.flatMap((e) => (e.kind === 'office:props' ? [e.props] : []));
  const cast = { spell: 'fireball' as const, origin: { x: 0, y: 1, z: 0 }, dir: { x: 0, y: 0, z: 1 }, distance: 4, targetId: 'bob' };

  it('places a prop for the whole room and replays it to a late joiner', async () => {
    const { peer } = await setup();
    const ann = await peer('ann');
    const bob = await peer('bob');

    ann.op(pool);
    await vi.waitFor(() => expect(bob.store.getState().placedProps).toHaveLength(1));
    expect(ann.results).toEqual([{ ok: true }]);
    expect(bob.store.getState().placedProps[0]).toMatchObject({ kindId: 'prop_pool', position: [4, 4, 6] });

    const late = await peer('cat');
    expect(late.store.getState().placedProps).toEqual(bob.store.getState().placedProps);
  });

  it('echoes the request id in the reply, and shows props the web backend pushes to a live room', async () => {
    const { peer, server } = await setup();
    const ann = await peer('ann');
    const bob = await peer('bob');
    ann.op({ ...pool, reqId: 'r7' });
    await vi.waitFor(() => expect(ann.results).toEqual([{ ok: true, reqId: 'r7' }]));
    const pushed: PlacedProp[] = [{ id: 'placed:9', kindId: 'prop_pool', position: [1, 4, 1], yawDeg: 0 }];
    server.pushOfficeProps('o1', pushed);
    await vi.waitFor(() => expect(bob.store.getState().placedProps).toEqual(pushed));
    server.pushOfficeProps('nobody-here', pushed);
  });

  it('answers a refused op to the sender only and drops a malformed frame', async () => {
    const api = fakePropsApi();
    const { peer } = await setup(api);
    const ann = await peer('ann');
    const bob = await peer('bob');
    ann.op(pool);
    ann.op(pool);
    ann.op(pool);
    await vi.waitFor(() => expect(ann.results).toHaveLength(3));
    expect(ann.results.at(-1)).toEqual({ ok: false, error: 'limit' });
    expect(propsIn(bob.events).at(-1)).toHaveLength(2);

    ann.op({ op: 'place', kindId: 'cube', position: [0, 0, 0], yawDeg: 0 });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(api.calls).toHaveLength(3);
  });

  it('is unavailable and empty without a backend', async () => {
    const server = new RealtimeServer({ port: 0 });
    await server.start();
    cleanups.push(() => server.stop());
    const channel = new WsChannel({ url: `ws://127.0.0.1:${server.boundPort}/ws`, userId: 'ann', officeId: 'o1' });
    const results: PropOpResult[] = [];
    channel.onCustom(PROP_OP_RESULT_KIND, (p) => results.push(p as PropOpResult));
    await channel.subscribe();
    cleanups.push(() => channel.close());
    channel.sendCustom(PROP_OP_KIND, pool);
    await vi.waitFor(() => expect(results).toEqual([{ ok: false, error: 'unavailable' }]));
  });

  it('relays a cast from a wand holder, and a late joiner sees the running effect', async () => {
    const { peer } = await setup();
    const ann = await peer('ann');
    const bob = await peer('bob');
    ann.actions.setSelfHeld('wand', 'stand-1');
    await vi.waitFor(() => expect(bob.store.getState().players['ann']?.held).toBe('wand'));

    ann.sync.sendCast(cast);
    await vi.waitFor(() => expect(bob.store.getState().spellEffects['bob']?.spell).toBe('fireball'));

    const late = await peer('cat');
    await vi.waitFor(() => expect(late.store.getState().spellEffects['bob']?.spell).toBe('fireball'));
    expect(late.store.getState().players['ann']).toMatchObject({ held: 'wand', heldStand: 'stand-1' });
    const effect = late.store.getState().spellEffects['bob']!;
    expect(effect.endsAt - Date.now()).toBeGreaterThan(1500);
  });

  it('drops a cast without the wand and a second cast inside the cooldown', async () => {
    const { peer } = await setup();
    const ann = await peer('ann');
    const bob = await peer('bob');
    const seen: NetEvent[] = [];
    bob.channel.on((e) => e.kind === 'spell:cast' && seen.push(e));

    ann.sync.sendCast(cast);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(seen).toHaveLength(0);

    ann.actions.setSelfHeld('wand', 's');
    await vi.waitFor(() => expect(bob.store.getState().players['ann']?.held).toBe('wand'));
    ann.sync.sendCast(cast);
    ann.sync.sendCast(cast);
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(seen).toHaveLength(1);
  });

  it('puts the wand back when its holder leaves', async () => {
    const { peer } = await setup();
    const ann = await peer('ann');
    const watcher = await peer('watcher');
    ann.actions.setSelfHeld('wand', 'stand-1');
    await vi.waitFor(() => expect(watcher.store.getState().players['ann']?.held).toBe('wand'));
    ann.close();
    await vi.waitFor(() => expect(watcher.store.getState().players['ann']).toBeUndefined());

    const bob = await peer('bob');
    await vi.waitFor(() => expect(bob.store.getState().players['watcher']).toBeDefined());
    expect(bob.store.getState().players['ann']?.held ?? null).toBeNull();
  });
});

describe('SpellCastGuard', () => {
  it('lets an eligible caster cast once per cooldown and refuses an ineligible one', () => {
    const guard = new SpellCastGuard();
    expect(guard.allow('a', true, 0)).toBe(true);
    expect(guard.allow('a', true, SPELL_COOLDOWN_MS * 0.5)).toBe(false);
    expect(guard.allow('a', true, SPELL_COOLDOWN_MS)).toBe(true);
    expect(guard.allow('a', false, 5000)).toBe(false);
    expect(guard.allow('b', true, 5)).toBe(true);
  });

  it('does not spend the cooldown on a refused cast', () => {
    const guard = new SpellCastGuard();
    expect(guard.allow('a', false, 0)).toBe(false);
    expect(guard.allow('a', true, 10)).toBe(true);
  });
});
