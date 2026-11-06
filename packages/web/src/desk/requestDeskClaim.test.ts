import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeskClaimRequester, DESK_CLAIM_TIMEOUT_MS } from './requestDeskClaim';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function fakeChannel() {
  const sent: unknown[] = [];
  let handler: (payload: unknown) => void = () => {};
  return {
    sent,
    reply: (payload: unknown) => handler(payload),
    channel: {
      sendCustom: (_kind: string, payload: unknown) => void sent.push(payload),
      onCustom: (_kind: string, h: (payload: unknown) => void) => void (handler = h),
    },
  };
}

describe('createDeskClaimRequester', () => {
  it('sends the claim and resolves with the reply', async () => {
    const { channel, sent, reply } = fakeChannel();
    const request = createDeskClaimRequester(channel);
    const result = request('d1');
    expect(sent).toEqual([{ deskId: 'd1' }]);
    reply({ ok: false, error: 'taken' });
    await expect(result).resolves.toEqual({ ok: false, error: 'taken' });
  });

  it('matches concurrent requests to replies in order', async () => {
    const { channel, reply } = fakeChannel();
    const request = createDeskClaimRequester(channel);
    const first = request('d1');
    const second = request(null);
    reply({ ok: false, error: 'unknown-desk' });
    reply({ ok: true });
    await expect(first).resolves.toEqual({ ok: false, error: 'unknown-desk' });
    await expect(second).resolves.toEqual({ ok: true });
  });

  it('resolves as unavailable when no reply arrives, and ignores malformed replies', async () => {
    const { channel, reply } = fakeChannel();
    const result = createDeskClaimRequester(channel)('d1');
    reply({ nonsense: true });
    vi.advanceTimersByTime(DESK_CLAIM_TIMEOUT_MS);
    await expect(result).resolves.toEqual({ ok: false, error: 'unavailable' });
  });
});
