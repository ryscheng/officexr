import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPropOpRequester, PROP_OP_TIMEOUT_MS } from './requestPropOp';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function fakeChannel(initial = 'live') {
  const sent: { kind: string; payload: { reqId?: string } & Record<string, unknown> }[] = [];
  let handler: (payload: unknown) => void = () => {};
  let statusHandler: (status: string) => void = () => {};
  return {
    sent,
    reply: (payload: unknown) => handler(payload),
    replyTo: (index: number, result: Record<string, unknown>) => handler({ ...result, reqId: sent[index]?.payload.reqId }),
    setStatus: (status: string) => statusHandler(status),
    channel: {
      sendCustom: (kind: string, payload: unknown) => void sent.push({ kind, payload: payload as never }),
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
  it('sends the op with a request id and resolves with the reply that echoes it', async () => {
    const { channel, sent, replyTo } = fakeChannel();
    const result = createPropOpRequester(channel).request(remove);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'prop:op', payload: { ...remove, reqId: expect.any(String) } });
    replyTo(0, { ok: false, error: 'limit' });
    await expect(result).resolves.toMatchObject({ ok: false, error: 'limit' });
  });

  it('matches replies to requests by id, in any order, and ignores replies without a known id', async () => {
    const { channel, reply, replyTo } = fakeChannel();
    const { request } = createPropOpRequester(channel);
    const first = request(remove);
    const second = request(remove);
    reply({ nonsense: true });
    reply({ ok: true });
    reply({ ok: true, reqId: 'unknown' });
    replyTo(1, { ok: true });
    replyTo(0, { ok: false, error: 'not-found' });
    await expect(first).resolves.toMatchObject({ ok: false, error: 'not-found' });
    await expect(second).resolves.toMatchObject({ ok: true });
  });

  it('does not give a reply that arrives after its request timed out to the next request', async () => {
    const { channel, replyTo } = fakeChannel();
    const requester = createPropOpRequester(channel);
    const first = requester.request(remove);
    await vi.advanceTimersByTimeAsync(PROP_OP_TIMEOUT_MS);
    await expect(first).resolves.toEqual(UNAVAILABLE);
    const second = requester.request({ op: 'place', kindId: 'prop_pool', position: [0, 0, 0], yawDeg: 0 });
    replyTo(0, { ok: false, error: 'not-found' });
    replyTo(1, { ok: true });
    await expect(second).resolves.toMatchObject({ ok: true });
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
