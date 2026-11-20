import { describe, expect, it } from 'vitest';
import { frozenClaimants } from '../game-state/seats.ts';
import { validateNetEvent } from '../realtime/protocol.ts';

const state = (players: string[], claims: Record<string, string>, claimants = {}) => ({
  selfId: 'me@x.io#t1',
  players: Object.fromEntries(players.map((id) => [id, {}])) as never,
  deskClaims: claims,
  deskClaimants: claimants,
});

describe('frozenClaimants', () => {
  it('is empty without claims', () => {
    expect(frozenClaimants(state([], {}))).toEqual([]);
  });

  it('lists claimants with no live session, leaving out self and present players', () => {
    const frozen = frozenClaimants(
      state(
        ['me@x.io#t1', 'ann.lee@x.io#t9'],
        { d4: 'cy@x.io', d1: 'me@x.io', d2: 'ann.lee@x.io', d3: 'bob@x.io' },
        { 'bob@x.io': { characterId: 'Mage', claimedAt: '2026-01-01T00:00:00.000Z' } },
      ),
    );
    expect(frozen).toEqual([
      { login: 'bob@x.io', deskId: 'd3', name: 'bob', characterId: 'Mage', claimedAt: '2026-01-01T00:00:00.000Z' },
      { login: 'cy@x.io', deskId: 'd4', name: 'cy' },
    ]);
  });

  it('treats a login as present while any of its sessions is in the room', () => {
    expect(frozenClaimants(state(['bob@x.io#a'], { d1: 'bob@x.io' }))).toEqual([]);
  });

  it('works from claims alone, as an older server sends them', () => {
    expect(frozenClaimants(state([], { d1: 'dee@x.io' }))).toEqual([{ login: 'dee@x.io', deskId: 'd1', name: 'dee' }]);
  });
});

describe('desk:claims payload', () => {
  const base = { kind: 'desk:claims', v: 1, actorId: 'a', seq: 1, t: 0 };
  it('accepts claimants and stays valid without them', () => {
    expect(validateNetEvent({ ...base, claims: { d1: 'x@x.io' }, claimants: { 'x@x.io': { characterId: 'Mage' } } }).ok).toBe(true);
    expect(validateNetEvent({ ...base, claims: { d1: 'x@x.io' } }).ok).toBe(true);
    expect(validateNetEvent({ ...base, claims: {}, claimants: { a: { characterId: 3 } } }).ok).toBe(false);
  });
});
