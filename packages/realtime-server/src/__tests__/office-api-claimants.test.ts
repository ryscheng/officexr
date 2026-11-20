import { describe, expect, it } from 'vitest';
import { createOfficeApi } from '../office-api.ts';

const apiReplying = (body: unknown) =>
  createOfficeApi({
    baseUrl: 'http://backend.test',
    fetch: async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
  });

describe('listDeskClaims claimants', () => {
  it('passes the claimants the backend sends', async () => {
    const claimants = { 'a@x.io': { characterId: 'Mage', claimedAt: '2026-01-01T00:00:00.000Z' } };
    expect(await apiReplying({ claims: { d1: 'a@x.io' }, claimants }).listDeskClaims('o', 'a@x.io')).toEqual({
      ok: true,
      claims: { d1: 'a@x.io' },
      claimants,
    });
  });

  it('accepts an older backend that sends claims alone', async () => {
    const outcome = await apiReplying({ claims: { d1: 'a@x.io' } }).listDeskClaims('o', 'a@x.io');
    expect(outcome).toEqual({ ok: true, claims: { d1: 'a@x.io' }, claimants: undefined });
  });

  it('rejects malformed claimants as unavailable', async () => {
    expect(await apiReplying({ claims: {}, claimants: { a: { characterId: 1 } } }).listDeskClaims('o', 'a')).toEqual({
      ok: false,
      error: 'unavailable',
    });
  });

  it('passes a calendar and a Slack status through, and rejects a malformed one', async () => {
    const claimants = { 'a@x.io': { calendar: { busy: true, until: '2026-11-20T15:00:00.000Z' }, slack: { text: 'Out', emoji: ':palm_tree:' } } };
    expect(await apiReplying({ claims: { d1: 'a@x.io' }, claimants }).listDeskClaims('o', 'a@x.io')).toEqual({ ok: true, claims: { d1: 'a@x.io' }, claimants });
    expect(await apiReplying({ claims: {}, claimants: { a: { calendar: { busy: 'yes', until: 'x' } } } }).listDeskClaims('o', 'a')).toEqual({ ok: false, error: 'unavailable' });
  });
});
