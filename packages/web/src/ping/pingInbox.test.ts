import { createBus, createStore } from '@officexr/sdk';
import { describe, expect, it } from 'vitest';
import { connectPingInbox, PingInbox } from './pingInbox';

describe('PingInbox', () => {
  it('keeps the newest 10 first, stamped by the injected clock', () => {
    let t = 1000;
    const inbox = new PingInbox(() => t++);
    for (let i = 0; i < 11; i++) {
      inbox.add(`p${i}#t`, `P${i}`);
    }
    const { entries } = inbox.getSnapshot();
    expect(entries).toHaveLength(10);
    expect(entries[0]).toMatchObject({ fromId: 'p10#t', receivedAt: 1010 });
    expect(entries[9].fromId).toBe('p1#t');
  });

  it('counts unread, and markAllRead and clear reset it', () => {
    const inbox = new PingInbox();
    inbox.add('a#t', 'A');
    inbox.add('b#t', 'B');
    expect(inbox.getSnapshot().unread).toBe(2);
    inbox.markAllRead();
    expect(inbox.getSnapshot()).toMatchObject({ unread: 0 });
    expect(inbox.getSnapshot().entries).toHaveLength(2);
    inbox.add('c#t', 'C');
    inbox.clear();
    expect(inbox.getSnapshot()).toEqual({ entries: [], unread: 0 });
  });
});

describe('connectPingInbox', () => {
  it('records bus pings under the sender name, falling back to the login', () => {
    const bus = createBus();
    const store = createStore({ selfId: 'me#t0', officeId: 'o' });
    store.setState((s) => ({ ...s, players: { 'ada#t1': { name: 'Ada' } } as never }));
    const inbox = new PingInbox();
    const off = connectPingInbox(bus, store, inbox);
    bus.emit({ kind: 'ping:received', fromId: 'ada#t1', at: 1 });
    bus.emit({ kind: 'ping:received', fromId: 'bob#t2', at: 2 });
    expect(inbox.getSnapshot().entries.map((e) => e.name)).toEqual(['bob', 'Ada']);
    off();
    bus.emit({ kind: 'ping:received', fromId: 'ada#t1', at: 3 });
    expect(inbox.getSnapshot().entries).toHaveLength(2);
  });
});
