import { afterEach, describe, expect, it } from 'vitest';
import { INTEGRATION_NOTICE_KIND, type IntegrationNotice, type NetEvent } from '@officexr/sdk';
import type { DeskClaimOutcome } from '../office-api.ts';
import { RealtimeServer } from '../server.ts';
import { WsChannel } from '../ws-channel.ts';

describe('integration hooks on the realtime server', () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0).reverse()) {
      await c();
    }
  });

  async function setup(claimsRefreshMs = 0) {
    let outcome: DeskClaimOutcome = { ok: true, claims: { d1: 'ann' }, claimants: { ann: {} } };
    const server = new RealtimeServer({
      port: 0,
      claimsRefreshMs,
      sessionPolicy: async () => true,
      deskClaims: {
        listDeskClaims: async () => outcome,
        claimDesk: async () => outcome,
        releaseDesk: async () => outcome,
      },
    });
    await server.start();
    cleanups.push(() => server.stop());
    const join = async (userId: string, officeId = 'o1') => {
      const channel = new WsChannel({ url: `ws://127.0.0.1:${server.boundPort}/ws`, userId, officeId });
      cleanups.push(() => channel.close());
      const notices: IntegrationNotice[] = [];
      const events: NetEvent[] = [];
      channel.on((e) => events.push(e));
      channel.onCustom(INTEGRATION_NOTICE_KIND, (p) => notices.push(p as IntegrationNotice));
      await channel.subscribe();
      return { notices, events };
    };
    return { server, join, setOutcome: (next: DeskClaimOutcome) => void (outcome = next) };
  }

  it('sends a notice to every session of one login in one office, and says whether anyone got it', async () => {
    const { server, join } = await setup();
    const ann = await join('ann#1');
    const ann2 = await join('ann#2');
    const bob = await join('bob#1');
    const elsewhere = await join('ann#3', 'o2');
    const notice = { from: 'bob', text: 'will be there in 5 minutes' };
    expect(server.notifyLogin('o1', 'ann', INTEGRATION_NOTICE_KIND, notice)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(ann.notices).toEqual([notice]);
    expect(ann2.notices).toEqual([notice]);
    expect(bob.notices).toEqual([]);
    expect(elsewhere.notices).toEqual([]);
    expect(server.notifyLogin('o1', 'nobody', INTEGRATION_NOTICE_KIND, notice)).toBe(false);
    expect(server.notifyLogin('no-office', 'ann', INTEGRATION_NOTICE_KIND, notice)).toBe(false);
  });

  it('sends a custom frame to everyone in one office, and says whether anyone got it', async () => {
    const { server, join } = await setup();
    const received: unknown[][] = [[], [], []];
    const listen = async (userId: string, officeId: string, into: unknown[]) => {
      const channel = new WsChannel({ url: `ws://127.0.0.1:${server.boundPort}/ws`, userId, officeId });
      cleanups.push(() => channel.close());
      channel.onCustom('missions:changed', (p) => into.push(p));
      await channel.subscribe();
    };
    await listen('ann#1', 'o1', received[0]);
    await listen('bob#1', 'o1', received[1]);
    await listen('cat#1', 'o2', received[2]);
    await join('dan#1');
    expect(server.notifyOffice('o1', 'missions:changed', { officeId: 'o1' })).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(received).toEqual([[{ officeId: 'o1' }], [{ officeId: 'o1' }], []]);
    expect(server.notifyOffice('no-office', 'missions:changed', { officeId: 'x' })).toBe(false);
  });

  it('knows who has a live session in an office', async () => {
    const { server, join } = await setup();
    await join('ann#1');
    expect(server.hasLiveSession('o1', 'ann')).toBe(true);
    expect(server.hasLiveSession('o1', 'bob')).toBe(false);
    expect(server.hasLiveSession('o2', 'ann')).toBe(false);
  });

  it('re-reads claimants on an interval while players are in, pushing only a change', async () => {
    const { join, setOutcome } = await setup(50);
    const bob = await join('bob#1');
    const claimsEvents = () => bob.events.filter((e) => e.kind === 'desk:claims');
    await new Promise((resolve) => setTimeout(resolve, 200));
    const before = claimsEvents().length;
    setOutcome({ ok: true, claims: { d1: 'ann' }, claimants: { ann: { calendar: { busy: true, until: '2026-11-20T15:00:00.000Z' } } } });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const claims = claimsEvents();
    expect(claims.length).toBe(before + 1);
    expect(claims.at(-1)).toMatchObject({ claimants: { ann: { calendar: { busy: true } } } });
  });

  it('does not poll when the refresh interval is off', async () => {
    const { join } = await setup(0);
    const bob = await join('bob#1');
    const initial = bob.events.filter((e) => e.kind === 'desk:claims').length;
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(bob.events.filter((e) => e.kind === 'desk:claims').length).toBe(initial);
  });
});
