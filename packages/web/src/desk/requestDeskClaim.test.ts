import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeskClaimRequester, DESK_CLAIM_TIMEOUT_MS } from './requestDeskClaim';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function fakeChannel(initial = 'live') {
  const sent: unknown[] = [];
  let handler: (payload: unknown) => void = () => {};
  let statusHandler: (status: string) => void = () => {};
  return {
    sent,
    reply: (payload: unknown) => handler(payload),
    setStatus: (status: string) => statusHandler(status),
    channel: {
      sendCustom: (_kind: string, payload: unknown) => void sent.push(payload),
      onCustom: (_kind: string, h: (payload: unknown) => void) => {
        handler = h;
        return () => void (handler = () => {});
      },
      onStatusChange: (h: (status: string) => void) => {
        statusHandler = h;
        h(initial);
        return () => void (statusHandler = () => {});
      },
    },
  };
}

const UNAVAILABLE = { ok: false, error: 'unavailable' };

describe('createDeskClaimRequester', () => {
  it('sends the claim and resolves with the reply', async () => {
    const { channel, sent, reply } = fakeChannel();
    const result = createDeskClaimRequester(channel).request('d1');
    expect(sent).toEqual([{ deskId: 'd1' }]);
    reply({ ok: false, error: 'taken' });
    await expect(result).resolves.toEqual({ ok: false, error: 'taken' });
  });

  it('matches concurrent requests to replies in order', async () => {
    const { channel, reply } = fakeChannel();
    const { request } = createDeskClaimRequester(channel);
    const first = request('d1');
    const second = request(null);
    reply({ ok: false, error: 'unknown-desk' });
    reply({ ok: true });
    await expect(first).resolves.toEqual({ ok: false, error: 'unknown-desk' });
    await expect(second).resolves.toEqual({ ok: true });
  });

  it('resolves as unavailable when no reply arrives, and ignores malformed replies', async () => {
    const { channel, reply } = fakeChannel();
    const result = createDeskClaimRequester(channel).request('d1');
    reply({ nonsense: true });
    vi.advanceTimersByTime(DESK_CLAIM_TIMEOUT_MS);
    await expect(result).resolves.toEqual(UNAVAILABLE);
  });

  it('hands a reply that arrives after its timeout to the next request in line', async () => {
    const { channel, reply } = fakeChannel();
    const { request } = createDeskClaimRequester(channel);
    const late = request('d1');
    vi.advanceTimersByTime(DESK_CLAIM_TIMEOUT_MS);
    await expect(late).resolves.toEqual(UNAVAILABLE);
    const next = request('d2');
    reply({ ok: false, error: 'taken' });
    await expect(next).resolves.toEqual({ ok: false, error: 'taken' });
  });

  it('fails at once while the channel is not live, and when it drops mid-request', async () => {
    const down = fakeChannel('reconnecting');
    const { sent, channel } = down;
    await expect(createDeskClaimRequester(channel).request('d1')).resolves.toEqual(UNAVAILABLE);
    expect(sent).toEqual([]);

    const live = fakeChannel();
    const inFlight = createDeskClaimRequester(live.channel).request('d1');
    live.setStatus('reconnecting');
    await expect(inFlight).resolves.toEqual(UNAVAILABLE);
  });

  it('fails waiting requests and stops listening when disposed', async () => {
    const { channel, reply } = fakeChannel();
    const requester = createDeskClaimRequester(channel);
    const waiting = requester.request('d1');
    requester.dispose();
    await expect(waiting).resolves.toEqual(UNAVAILABLE);
    reply({ ok: true });
  });
});
