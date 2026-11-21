import { describe, expect, it } from 'vitest';
import { createStore } from '../../game-state/store.ts';
import { createActions } from '../../game-state/actions.ts';
import { deskOwnedBy, parseSeatId, seatId, seatOccupant } from '../../game-state/seats.ts';
import { applyNetEventToStore } from '../../realtime/apply-net-event.ts';
import { validateNetEvent } from '../../realtime/protocol.ts';
import { ZDeskClaim, ZDeskClaimResult } from '../../realtime/desk-claim.ts';
import { FakeClock } from '../../test-harness/time.ts';
import { createMultiClientHarness } from '../../test-harness/two-client.ts';

describe('presence:seat', () => {
  it('converges on sit and stand, and reaches a late joiner via snapshot', async () => {
    const h = createMultiClientHarness();
    const a = await h.add('a');
    const b = await h.add('b');

    a.actions.setSelfSeat('chair-1');
    expect(b.store.getState().players['a']?.seat).toBe('chair-1');
    expect(seatOccupant(b.store.getState(), 'chair-1')).toBe('a');

    const c = await h.add('c');
    await c.handshake.requestSnapshot();
    expect(c.store.getState().players['a']?.seat).toBe('chair-1');

    a.actions.setSelfSeat(null);
    expect(b.store.getState().players['a']?.seat).toBeNull();
    expect(seatOccupant(b.store.getState(), 'chair-1')).toBeNull();
  });

  it('announces a seat taken while held once the player is released', async () => {
    const h = createMultiClientHarness();
    const a = await h.add('a', { holdSelf: true });
    const b = await h.add('b');
    a.actions.setSelfSeat('chair-1');
    expect(b.store.getState().players['a']?.seat).toBeUndefined();

    a.sync.releaseSelf();
    expect(b.store.getState().players['a']?.seat).toBe('chair-1');
  });

  it('rejects malformed payloads', () => {
    const env = { v: 1, actorId: 'a', seq: 1, t: 0 };
    expect(validateNetEvent({ ...env, kind: 'presence:seat', instanceId: null }).ok).toBe(true);
    expect(validateNetEvent({ ...env, kind: 'presence:seat', instanceId: 3 }).ok).toBe(false);
  });

  it('is broadcast on change only', async () => {
    const h = createMultiClientHarness();
    const a = await h.add('a');
    const seen: string[] = [];
    (await h.add('b')).channel.on((e) => {
      if (e.kind === 'presence:seat') {
        seen.push(e.kind);
      }
    });
    a.actions.setSelfSeat('chair-1');
    a.actions.setSelfSeat('chair-1');
    h.step(1_000);
    expect(seen).toHaveLength(1);
  });
});

describe('seats of one instance', () => {
  it('names seat 0 by the bare instance id and round-trips the others', () => {
    expect(seatId('couch@1,0,2', 0)).toBe('couch@1,0,2');
    expect(seatId('couch@1,0,2', 2)).toBe('couch@1,0,2#2');
    expect(parseSeatId('couch@1,0,2')).toEqual({ instanceId: 'couch@1,0,2', index: 0 });
    expect(parseSeatId('couch@1,0,2#2')).toEqual({ instanceId: 'couch@1,0,2', index: 2 });
    expect(parseSeatId('odd#name')).toEqual({ instanceId: 'odd#name', index: 0 });
    expect(parseSeatId('x#0')).toEqual({ instanceId: 'x#0', index: 0 });
  });

  it('shows each of three players on their own seat of one couch, to every client', async () => {
    const h = createMultiClientHarness();
    const a = await h.add('a');
    const b = await h.add('b');
    const c = await h.add('c');
    a.actions.setSelfSeat(seatId('couch', 0));
    b.actions.setSelfSeat(seatId('couch', 1));
    c.actions.setSelfSeat(seatId('couch', 2));

    for (const client of [a, b, c]) {
      const state = client.store.getState();
      expect([0, 1, 2].map((i) => seatOccupant(state, seatId('couch', i)))).toEqual(['a', 'b', 'c']);
      expect(seatOccupant(state, seatId('couch', 1), 'b')).toBeNull();
    }

    b.actions.setSelfSeat(null);
    expect(seatOccupant(a.store.getState(), seatId('couch', 1))).toBeNull();
    expect(seatOccupant(a.store.getState(), seatId('couch', 2))).toBe('c');
  });

  it('keeps a bare instance id as seat 0 for a client that knows one seat per instance', async () => {
    const h = createMultiClientHarness();
    const old = await h.add('old');
    const current = await h.add('new');
    old.actions.setSelfSeat('couch');
    expect(seatOccupant(current.store.getState(), seatId('couch', 0))).toBe('old');
    expect(seatOccupant(current.store.getState(), seatId('couch', 1))).toBeNull();
  });
});

describe('desk:claims', () => {
  it('replaces the claims', () => {
    const store = createStore({ selfId: 'me', officeId: 'o' });
    const actions = createActions(store);
    const clock = new FakeClock(0);
    const apply = (claims: Record<string, string>) =>
      applyNetEventToStore(
        actions,
        { kind: 'desk:claims', v: 1, actorId: 'server', seq: 1, t: 0, claims },
        clock,
      );

    apply({ d1: 'x@example.com', d2: 'y@example.com' });
    apply({ d3: 'x@example.com' });
    expect(store.getState().deskClaims).toEqual({ d3: 'x@example.com' });
    expect(deskOwnedBy(store.getState(), 'x@example.com')).toBe('d3');
    expect(deskOwnedBy(store.getState(), 'y@example.com')).toBeNull();
  });

  it('is not carried by a peer snapshot', async () => {
    const h = createMultiClientHarness();
    const a = await h.add('a');
    a.actions.setDeskClaims({ d1: 'a@example.com' });
    const b = await h.add('b');
    await b.handshake.requestSnapshot();
    expect(b.store.getState().deskClaims).toEqual({});
  });

  it('rejects malformed payloads', () => {
    const env = { v: 1, actorId: 's', seq: 1, t: 0 };
    expect(validateNetEvent({ ...env, kind: 'desk:claims', claims: { d1: 'x' } }).ok).toBe(true);
    expect(validateNetEvent({ ...env, kind: 'desk:claims', claims: { d1: 3 } }).ok).toBe(false);
  });
});

describe('desk custom frame schemas', () => {
  it('validates claim requests', () => {
    expect(ZDeskClaim.safeParse({ deskId: 'd1' }).success).toBe(true);
    expect(ZDeskClaim.safeParse({ deskId: null }).success).toBe(true);
    expect(ZDeskClaim.safeParse({}).success).toBe(false);
    expect(ZDeskClaim.safeParse({ deskId: 1 }).success).toBe(false);
  });

  it('validates claim results', () => {
    expect(ZDeskClaimResult.safeParse({ ok: true }).success).toBe(true);
    expect(ZDeskClaimResult.safeParse({ ok: false, error: 'taken' }).success).toBe(true);
    expect(ZDeskClaimResult.safeParse({ ok: false }).success).toBe(false);
    expect(ZDeskClaimResult.safeParse({ ok: false, error: 'nope' }).success).toBe(false);
    expect(ZDeskClaimResult.safeParse({ ok: 'yes' }).success).toBe(false);
  });
});
