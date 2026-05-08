import { describe, it, expect, vi } from 'vitest';
import { createInMemoryChannelHub, InMemoryChannel } from '../../realtime/channel.ts';
import type { NetEvent } from '../../realtime/protocol.ts';

function chatEvent(actorId: string, seq: number, text: string): NetEvent {
  return { kind: 'chat:message', v: 1, actorId, seq, t: 0, text };
}

describe('InMemoryChannel', () => {
  it('send delivers to other peers but not the sender', async () => {
    const hub = createInMemoryChannelHub();
    const a = new InMemoryChannel(hub, 'A');
    const b = new InMemoryChannel(hub, 'B');
    await a.subscribe();
    await b.subscribe();
    const aReceived: NetEvent[] = [];
    const bReceived: NetEvent[] = [];
    a.on((e) => aReceived.push(e));
    b.on((e) => bReceived.push(e));
    await a.send(chatEvent('A', 1, 'hi'));
    expect(aReceived).toHaveLength(0);
    expect(bReceived).toHaveLength(1);
    expect(bReceived[0].kind).toBe('chat:message');
  });

  it('multiple peers all receive the same broadcast', async () => {
    const hub = createInMemoryChannelHub();
    const a = new InMemoryChannel(hub, 'A');
    const b = new InMemoryChannel(hub, 'B');
    const c = new InMemoryChannel(hub, 'C');
    await Promise.all([a.subscribe(), b.subscribe(), c.subscribe()]);
    const bReceived: NetEvent[] = [];
    const cReceived: NetEvent[] = [];
    b.on((e) => bReceived.push(e));
    c.on((e) => cReceived.push(e));
    await a.send(chatEvent('A', 1, 'hi'));
    expect(bReceived).toHaveLength(1);
    expect(cReceived).toHaveLength(1);
  });

  it('presence join fires onPresenceChange for others', async () => {
    const hub = createInMemoryChannelHub();
    const a = new InMemoryChannel(hub, 'A');
    const joined: string[] = [];
    a.onPresenceChange((newJoined) => {
      for (const id of newJoined) joined.push(id);
    });
    await a.subscribe();
    a.trackPresence({ name: 'Alice' });

    const b = new InMemoryChannel(hub, 'B');
    await b.subscribe();
    b.trackPresence({ name: 'Bob' });
    expect(joined).toContain('B');
  });

  it('presence leave fires for remaining peers', async () => {
    const hub = createInMemoryChannelHub();
    const a = new InMemoryChannel(hub, 'A');
    const b = new InMemoryChannel(hub, 'B');
    const left: string[] = [];
    a.onPresenceChange((_j, l) => {
      for (const id of l) left.push(id);
    });
    await a.subscribe();
    a.trackPresence({});
    await b.subscribe();
    b.trackPresence({});
    b.close();
    expect(left).toContain('B');
  });

  it('close stops further delivery', async () => {
    const hub = createInMemoryChannelHub();
    const a = new InMemoryChannel(hub, 'A');
    const b = new InMemoryChannel(hub, 'B');
    await a.subscribe();
    await b.subscribe();
    const seen = vi.fn();
    b.on(seen);
    b.close();
    await a.send(chatEvent('A', 1, 'after-close'));
    expect(seen).not.toHaveBeenCalled();
  });

  it('unsubscribe handler removes only that listener', async () => {
    const hub = createInMemoryChannelHub();
    const a = new InMemoryChannel(hub, 'A');
    const b = new InMemoryChannel(hub, 'B');
    await Promise.all([a.subscribe(), b.subscribe()]);
    const fa = vi.fn();
    const fb = vi.fn();
    const off = b.on(fa);
    b.on(fb);
    off();
    await a.send(chatEvent('A', 1, 'x'));
    expect(fa).not.toHaveBeenCalled();
    expect(fb).toHaveBeenCalledTimes(1);
  });

  it('listPresent reflects currently subscribed peers', async () => {
    const hub = createInMemoryChannelHub();
    const a = new InMemoryChannel(hub, 'A');
    const b = new InMemoryChannel(hub, 'B');
    await a.subscribe();
    a.trackPresence({});
    await b.subscribe();
    b.trackPresence({});
    expect(a.listPresent().sort()).toEqual(['A', 'B']);
    b.close();
    expect(a.listPresent()).toEqual(['A']);
  });
});
