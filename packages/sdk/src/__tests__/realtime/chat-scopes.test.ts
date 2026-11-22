import { describe, expect, it } from 'vitest';
import { createMultiClientHarness } from '../../test-harness/two-client.ts';
import { PROTOCOL, recipientOf, validateNetEvent, type NetEvent } from '../../realtime/protocol.ts';

const send = (h: Awaited<ReturnType<typeof setup>>['a'], msg: { text: string; scope?: 'nearby' | 'direct'; to?: string }) =>
  h.actions.appendChat({ id: `m-${msg.text}`, authorId: 'A', t: 1, ...msg });

async function setup() {
  const h = createMultiClientHarness();
  const a = await h.add('A');
  const b = await h.add('B');
  const c = await h.add('C');
  return { h, a, b, c };
}

describe('chat scopes', () => {
  it('sends an unscoped message as chat:message and a nearby one as chat:nearby', async () => {
    const { a, b } = await setup();
    const atB: NetEvent[] = [];
    b.channel.on((e) => atB.push(e));
    send(a, { text: 'all' });
    send(a, { text: 'close', scope: 'nearby' });
    expect(atB.map((e) => e.kind)).toEqual(['chat:message', 'chat:nearby']);
    expect(b.store.getState().chat.map((m) => [m.text, m.scope])).toEqual([['all', undefined], ['close', 'nearby']]);
  });

  it('delivers a direct message to its target only, marked direct and addressed to the target', async () => {
    const { a, b, c } = await setup();
    send(a, { text: 'psst', scope: 'direct', to: 'B' });
    expect(b.store.getState().chat).toMatchObject([{ text: 'psst', authorId: 'A', scope: 'direct', to: 'B' }]);
    expect(c.store.getState().chat).toEqual([]);
  });

  it('does not send a direct message that has no target', async () => {
    const { a, b, c } = await setup();
    send(a, { text: 'lost', scope: 'direct' });
    expect(b.store.getState().chat).toEqual([]);
    expect(c.store.getState().chat).toEqual([]);
  });

  it('routes chat:direct to its target and chat:nearby to the room', () => {
    expect(PROTOCOL['chat:direct'].route).toBe('target');
    expect(PROTOCOL['chat:nearby'].route).toBe('room');
    const base = { v: 1 as const, actorId: 'A', seq: 1, t: 1 };
    expect(recipientOf({ ...base, kind: 'chat:direct', targetId: 'B', text: 'x' })).toBe('B');
    expect(recipientOf({ ...base, kind: 'chat:nearby', text: 'x' })).toBeNull();
  });

  it('rejects an empty or overlong body and a direct message without a target', () => {
    const base = { v: 1, actorId: 'A', seq: 1, t: 1 };
    expect(validateNetEvent({ ...base, kind: 'chat:nearby', text: '' }).ok).toBe(false);
    expect(validateNetEvent({ ...base, kind: 'chat:nearby', text: 'x'.repeat(501) }).ok).toBe(false);
    expect(validateNetEvent({ ...base, kind: 'chat:direct', text: 'x' }).ok).toBe(false);
    expect(validateNetEvent({ ...base, kind: 'chat:direct', targetId: 'B', text: 'x' }).ok).toBe(true);
  });
});
