import { createBus, createStore } from '@officexr/sdk';
import { describe, expect, it } from 'vitest';
import { connectSocialToasts, SocialToastQueue } from './socialToasts';

describe('SocialToastQueue', () => {
  it('queues in arrival order and keeps one toast per sender and kind', () => {
    const queue = new SocialToastQueue();
    queue.add('invite', 'a#t', 'Ana');
    queue.add('wave', 'b#t', 'Ben');
    queue.add('invite', 'a#t', 'Ana');
    expect(queue.getSnapshot().map((t) => `${t.kind}:${t.fromId}`)).toEqual(['wave:b#t', 'invite:a#t']);
  });

  it('drops a toast when dismissed', () => {
    const queue = new SocialToastQueue();
    queue.add('ping', 'a#t', 'Ana');
    queue.dismiss(queue.getSnapshot()[0].id);
    expect(queue.getSnapshot()).toEqual([]);
  });
});

describe('connectSocialToasts', () => {
  it('turns bus events into toasts named after the sender, a plain ping by default', () => {
    const bus = createBus();
    const store = createStore({ selfId: 'me#t0', officeId: 'o' });
    store.setState((s) => ({ ...s, players: { 'ana#t1': { name: 'Ana' } } as never }));
    const queue = new SocialToastQueue();
    const off = connectSocialToasts(bus, store, queue);
    bus.emit({ kind: 'ping:received', fromId: 'ana#t1', at: 1, intent: 'invite' });
    bus.emit({ kind: 'ping:received', fromId: 'ana#t1', at: 2 });
    expect(queue.getSnapshot().map((t) => [t.kind, t.name])).toEqual([['invite', 'Ana'], ['ping', 'Ana']]);
    off();
    bus.emit({ kind: 'ping:received', fromId: 'ana#t1', at: 3, intent: 'wave' });
    expect(queue.getSnapshot()).toHaveLength(2);
  });
});
