import { describe, it, expect, vi } from 'vitest';
import { createBus } from '../../game-state/bus.ts';
import type { GameEvent } from '../../game-state/types.ts';

describe('bus', () => {
  it('emits to handlers synchronously', () => {
    const bus = createBus();
    const order: string[] = [];
    bus.on('chat:message', () => order.push('handler'));
    bus.emit({ kind: 'chat:message', msg: { id: 'm1', authorId: 'a', text: 'hi', t: 0 } });
    order.push('after-emit');
    expect(order).toEqual(['handler', 'after-emit']);
  });

  it('invokes multiple handlers in registration order', () => {
    const bus = createBus();
    const order: number[] = [];
    bus.on('player:join', () => order.push(1));
    bus.on('player:join', () => order.push(2));
    bus.on('player:join', () => order.push(3));
    bus.emit({ kind: 'player:join', playerId: 'p' });
    expect(order).toEqual([1, 2, 3]);
  });

  it('off() removes a handler without affecting siblings', () => {
    const bus = createBus();
    const a = vi.fn();
    const b = vi.fn();
    const offA = bus.on('player:leave', a);
    bus.on('player:leave', b);
    offA();
    bus.emit({ kind: 'player:leave', playerId: 'x' });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('isolates handlers by kind', () => {
    const bus = createBus();
    const onJoin = vi.fn();
    const onLeave = vi.fn();
    bus.on('player:join', onJoin);
    bus.on('player:leave', onLeave);
    bus.emit({ kind: 'player:join', playerId: 'p' });
    expect(onJoin).toHaveBeenCalledTimes(1);
    expect(onLeave).not.toHaveBeenCalled();
  });

  it('isolates handler exceptions: a throwing handler does not stop later handlers', () => {
    const bus = createBus();
    const after = vi.fn();
    const errors: unknown[] = [];
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation((e: unknown) => {
      errors.push(e);
    });
    bus.on('player:join', () => {
      throw new Error('boom');
    });
    bus.on('player:join', after);
    bus.emit({ kind: 'player:join', playerId: 'p' });
    expect(after).toHaveBeenCalledTimes(1);
    expect(errors.length).toBeGreaterThan(0);
    consoleSpy.mockRestore();
  });

  it('passes the typed payload to handlers', () => {
    const bus = createBus();
    let received: Extract<GameEvent, { kind: 'chat:message' }> | null = null;
    bus.on('chat:message', (e) => {
      received = e;
    });
    bus.emit({
      kind: 'chat:message',
      msg: { id: 'm1', authorId: 'alice', text: 'hello', t: 1234 },
    });
    expect(received).not.toBeNull();
    expect(received!.msg.authorId).toBe('alice');
    expect(received!.msg.text).toBe('hello');
  });

  it('emits with no handlers does not throw', () => {
    const bus = createBus();
    expect(() => bus.emit({ kind: 'player:join', playerId: 'p' })).not.toThrow();
  });
});
