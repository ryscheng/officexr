import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPropOpRequester, PROP_OP_TIMEOUT_MS } from './requestPropOp';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function fakeChannel(initial = 'live') {
  const sent: { kind: string; payload: unknown }[] = [];
  let handler: (payload: unknown) => void = () => {};
  let statusHandler: (status: string) => void = () => {};
  return {
    sent,
    reply: (payload: unknown) => handler(payload),
    setStatus: (status: string) => statusHandler(status),
    channel: {
      sendCustom: (kind: string, payload: unknown) => void sent.push({ kind, payload }),
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

const remove = { op: 'remove', id: 'placed:1' } as const;
const UNAVAILABLE = { ok: false, error: 'unavailable' };

describe('createPropOpRequester', () => {
  it('sends the op as a prop:op frame and resolves with the reply', async () => {
    const { channel, sent, reply } = fakeChannel();
    const result = createPropOpRequester(channel).request(remove);
    expect(sent).toEqual([{ kind: 'prop:op', payload: remove }]);
    reply({ ok: false, error: 'limit' });
    await expect(result).resolves.toEqual({ ok: false, error: 'limit' });
  });

  it('matches concurrent requests to replies in order and ignores malformed replies', async () => {
    const { channel, reply } = fakeChannel();
    const { request } = createPropOpRequester(channel);
    const first = request(remove);
    const second = request(remove);
    reply({ nonsense: true });
    reply({ ok: false, error: 'not-found' });
    reply({ ok: true });
    await expect(first).resolves.toEqual({ ok: false, error: 'not-found' });
    await expect(second).resolves.toEqual({ ok: true });
  });

  it('is unavailable at once while the channel is not live, when it drops, and after a silent timeout', async () => {
    const down = fakeChannel('connecting');
    await expect(createPropOpRequester(down.channel).request(remove)).resolves.toEqual(UNAVAILABLE);
    expect(down.sent).toEqual([]);

    const live = fakeChannel();
    const requester = createPropOpRequester(live.channel);
    const dropped = requester.request(remove);
    live.setStatus('reconnecting');
    await expect(dropped).resolves.toEqual(UNAVAILABLE);

    live.setStatus('live');
    const silent = requester.request(remove);
    vi.advanceTimersByTime(PROP_OP_TIMEOUT_MS);
    await expect(silent).resolves.toEqual(UNAVAILABLE);
  });

  it('resolves pending requests as unavailable on dispose', async () => {
    const { channel } = fakeChannel();
    const requester = createPropOpRequester(channel);
    const pending = requester.request(remove);
    requester.dispose();
    await expect(pending).resolves.toEqual(UNAVAILABLE);
  });
});
