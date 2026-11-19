import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../../game-state/types.ts';
import { InMemoryChannel } from '../../realtime/channel.ts';
import { PROTOCOL, validateNetEvent, type NetEvent } from '../../realtime/protocol.ts';
import { createMultiClientHarness } from '../../test-harness/two-client.ts';
import type { PlacedProp } from '../../placement/props.ts';

const castBase = { origin: { x: 0, y: 1, z: 0 }, dir: { x: 0, y: 0, z: 1 }, distance: 4 };

describe('wand holding', () => {
  it('shows a peer holding the wand and which stand it came from, then clears it', async () => {
    const h = createMultiClientHarness();
    const a = await h.add('A');
    const b = await h.add('B');

    a.actions.setSelfHeld('wand', 'placed:1');
    expect(b.store.getState().players['A']).toMatchObject({ held: 'wand', heldStand: 'placed:1' });

    a.actions.setSelfHeld(null);
    expect(b.store.getState().players['A']).toMatchObject({ held: null, heldStand: null });
  });

  it('reaches a late joiner through the snapshot', async () => {
    const h = createMultiClientHarness();
    const a = await h.add('A');
    a.actions.setSelfHeld('wand', 'stand-1');
    const c = await h.add('C');
    await c.handshake.requestSnapshot();
    expect(c.store.getState().players['A']).toMatchObject({ held: 'wand', heldStand: 'stand-1' });
  });

  it('rejects an item the protocol does not know', () => {
    const base = { kind: 'presence:held', v: 1, actorId: 'A', seq: 1, t: 0 };
    expect(validateNetEvent({ ...base, held: 'broom' }).ok).toBe(false);
    expect(validateNetEvent({ ...base, held: 'wand', stand: 's' }).ok).toBe(true);
  });
});

describe('spell:cast', () => {
  it('reaches every peer, and the target gets an effect that starts when the bolt lands', async () => {
    const h = createMultiClientHarness();
    const a = await h.add('A');
    const b = await h.add('B');
    const c = await h.add('C');
    const seen: GameEvent[] = [];
    c.bus.on('spell:cast', (e) => seen.push(e));

    h.clock.advance(1000);
    a.sync.sendCast({ spell: 'fireball', ...castBase, targetId: 'B' });

    expect(seen).toEqual([expect.objectContaining({ kind: 'spell:cast', casterId: 'A' })]);
    const effect = b.store.getState().spellEffects['B'];
    expect(effect).toMatchObject({ spell: 'fireball', casterId: 'A', startsAt: 1500, endsAt: 4500 });
    expect(c.store.getState().spellEffects['B']).toEqual(effect);
  });

  it('a miss tells the bus but leaves no effect', async () => {
    const h = createMultiClientHarness();
    const a = await h.add('A');
    const b = await h.add('B');
    const seen: GameEvent[] = [];
    b.bus.on('spell:cast', (e) => seen.push(e));

    a.sync.sendCast({ spell: 'shrink', ...castBase, targetId: null });

    expect(seen).toHaveLength(1);
    expect(b.store.getState().spellEffects).toEqual({});
  });

  it('rejects an unknown spell, a far shot and a bad direction', () => {
    const base = { kind: 'spell:cast', v: 1, actorId: 'A', seq: 1, t: 0, ...castBase, targetId: null };
    expect(validateNetEvent({ ...base, spell: 'fireball' }).ok).toBe(true);
    expect(validateNetEvent({ ...base, spell: 'meteor' }).ok).toBe(false);
    expect(validateNetEvent({ ...base, spell: 'fireball', distance: 50 }).ok).toBe(false);
    expect(validateNetEvent({ ...base, spell: 'fireball', dir: { x: 'up' } }).ok).toBe(false);
  });

  it('only the server may send the replay events', () => {
    expect(PROTOCOL['spell:effect'].authority).toBe('server');
    expect(PROTOCOL['office:props'].authority).toBe('server');
    expect(PROTOCOL['spell:cast'].authority).toBe('local');
  });
});

describe('server events', () => {
  async function serverChannel(h: ReturnType<typeof createMultiClientHarness>) {
    const server = new InMemoryChannel(h.hub, 'server');
    await server.subscribe();
    return (event: Record<string, unknown>) => server.send({ ...event, actorId: 'server', seq: 1, t: 0 } as NetEvent);
  }

  it('office:props reaches every client the same way', async () => {
    const h = createMultiClientHarness();
    const a = await h.add('A');
    const b = await h.add('B');
    const push = await serverChannel(h);
    const props: PlacedProp[] = [{ id: 'placed:1', kindId: 'prop_pool', position: [4, 4, 6], yawDeg: 90 }];

    push({ kind: 'office:props', v: 1, props });

    expect(a.store.getState().placedProps).toEqual(props);
    expect(b.store.getState().placedProps).toEqual(props);
  });

  it('rejects office:props with a kind that is not placeable', () => {
    const base = { kind: 'office:props', v: 1, actorId: 'server', seq: 1, t: 0 };
    const prop = { id: 'p', kindId: 'prop_pool', position: [0, 0, 0], yawDeg: 0 };
    expect(validateNetEvent({ ...base, props: [prop] }).ok).toBe(true);
    expect(validateNetEvent({ ...base, props: [{ ...prop, kindId: 'cube' }] }).ok).toBe(false);
    expect(validateNetEvent({ ...base, props: [{ ...prop, position: [0.3, 0, 0] }] }).ok).toBe(false);
  });

  it('spell:effect shows a running effect to a late joiner until it expires', async () => {
    const h = createMultiClientHarness();
    const late = await h.add('L');
    const push = await serverChannel(h);

    push({ kind: 'spell:effect', v: 1, targetId: 'B', spell: 'levitate', casterId: 'A', remainingMs: 2000, elapsedMs: 3000 });

    expect(late.store.getState().spellEffects['B']).toEqual({ spell: 'levitate', casterId: 'A', startsAt: -3000, endsAt: 2000 });
  });
});
