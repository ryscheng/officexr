import { describe, it, expect, vi } from 'vitest';
import { createStore } from '../../game-state/store.ts';
import { createBus } from '../../game-state/bus.ts';
import { createRuleRegistry } from '../../game-state/rules.ts';
import type { OfficeState, GameEvent } from '../../game-state/types.ts';

describe('rules', () => {
  it('addRule preserves registration order on tick', () => {
    const store = createStore({ selfId: 'me', officeId: 'r' });
    const bus = createBus();
    const reg = createRuleRegistry();
    const order: number[] = [];
    reg.addRule(() => order.push(1));
    reg.addRule(() => order.push(2));
    reg.addRule(() => order.push(3));
    reg.tick(store.getState(), store.getState(), bus);
    expect(order).toEqual([1, 2, 3]);
  });

  it('tick passes (state, prev, bus) to each rule', () => {
    const store = createStore({ selfId: 'me', officeId: 'r' });
    const bus = createBus();
    const reg = createRuleRegistry();
    const seen: Array<{ s: OfficeState; p: OfficeState }> = [];
    reg.addRule((s, p) => seen.push({ s, p }));
    const prev = store.getState();
    store.setState((s) => ({
      chat: [...s.chat, { id: 'm', authorId: 'me', text: 'x', t: 0 }],
    }));
    const next = store.getState();
    reg.tick(next, prev, bus);
    expect(seen).toHaveLength(1);
    expect(seen[0].p.chat).toHaveLength(0);
    expect(seen[0].s.chat).toHaveLength(1);
  });

  it('a throwing rule is isolated from later rules', () => {
    const store = createStore({ selfId: 'me', officeId: 'r' });
    const bus = createBus();
    const reg = createRuleRegistry();
    const after = vi.fn();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    reg.addRule(() => {
      throw new Error('rule boom');
    });
    reg.addRule(after);
    reg.tick(store.getState(), store.getState(), bus);
    expect(after).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });

  it('rules can emit on the bus and subscribers see emissions', () => {
    const store = createStore({ selfId: 'me', officeId: 'r' });
    const bus = createBus();
    const reg = createRuleRegistry();
    const events: GameEvent[] = [];
    bus.on('player:join', (e) => events.push(e));
    reg.addRule((_s, _p, b) => b.emit({ kind: 'player:join', playerId: 'X' }));
    reg.tick(store.getState(), store.getState(), bus);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ kind: 'player:join', playerId: 'X' });
  });
});
