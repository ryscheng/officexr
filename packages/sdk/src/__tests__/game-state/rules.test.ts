import { describe, it, expect, vi } from 'vitest';
import { createStore } from '../../game-state/store.ts';
import { createBus } from '../../game-state/bus.ts';
import {
  createRuleRegistry,
  type TickRule,
} from '../../game-state/rules.ts';
import type { OfficeState, GameEvent } from '../../game-state/types.ts';

describe('rules', () => {
  it('addRule preserves registration order on tick', () => {
    const store = createStore({ selfId: 'me', officeId: 'r' });
    const bus = createBus();
    const reg = createRuleRegistry();
    const order: number[] = [];
    reg.addRule({ kind: 'tick', fn: () => order.push(1) });
    reg.addRule({ kind: 'tick', fn: () => order.push(2) });
    reg.addRule({ kind: 'tick', fn: () => order.push(3) });
    reg.tick(store.getState(), store.getState(), bus);
    expect(order).toEqual([1, 2, 3]);
  });

  it('tick passes (state, prev, bus) to each rule', () => {
    const store = createStore({ selfId: 'me', officeId: 'r' });
    const bus = createBus();
    const reg = createRuleRegistry();
    const seen: Array<{ s: OfficeState; p: OfficeState }> = [];
    reg.addRule({
      kind: 'tick',
      fn: (s, p) => seen.push({ s, p }),
    });
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
    reg.addRule({
      kind: 'tick',
      fn: () => {
        throw new Error('rule boom');
      },
    });
    reg.addRule({ kind: 'tick', fn: after });
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
    reg.addRule({
      kind: 'tick',
      fn: (_s, _p, b) => b.emit({ kind: 'player:join', playerId: 'X' }),
    });
    reg.tick(store.getState(), store.getState(), bus);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ kind: 'player:join', playerId: 'X' });
  });

  it('TickRule with frequency:N fires every Nth tick', () => {
    const store = createStore({ selfId: 'me', officeId: 'r' });
    const bus = createBus();
    const reg = createRuleRegistry();
    let n = 0;
    const rule: TickRule = {
      kind: 'tick',
      frequency: 3,
      fn: () => n++,
    };
    reg.addRule(rule);
    for (let i = 0; i < 9; i++) reg.tick(store.getState(), store.getState(), bus);
    // tickCount goes 1..9; only ticks where (count % 3 === 0) fire: 3, 6, 9.
    expect(n).toBe(3);
  });

  it('TickContext.getPlayerGrid memoises by cellSize within a tick', () => {
    const store = createStore({ selfId: 'me', officeId: 'r' });
    const bus = createBus();
    const reg = createRuleRegistry();
    let firstGrid: object | undefined;
    let secondGrid: object | undefined;
    let differentSize: object | undefined;
    reg.addRule({
      kind: 'tick',
      fn: (_s, _p, _b, ctx) => {
        firstGrid = ctx.getPlayerGrid(3);
      },
    });
    reg.addRule({
      kind: 'tick',
      fn: (_s, _p, _b, ctx) => {
        secondGrid = ctx.getPlayerGrid(3);
        differentSize = ctx.getPlayerGrid(0.85);
      },
    });
    reg.tick(store.getState(), store.getState(), bus);
    // Same size → same instance shared across rules.
    expect(firstGrid).toBe(secondGrid);
    // Different size → fresh build.
    expect(firstGrid).not.toBe(differentSize);
  });

  it('a fresh TickContext is built per tick (grids do not leak across ticks)', () => {
    const store = createStore({ selfId: 'me', officeId: 'r' });
    const bus = createBus();
    const reg = createRuleRegistry();
    const grids: object[] = [];
    reg.addRule({
      kind: 'tick',
      fn: (_s, _p, _b, ctx) => {
        grids.push(ctx.getPlayerGrid(3));
      },
    });
    reg.tick(store.getState(), store.getState(), bus);
    reg.tick(store.getState(), store.getState(), bus);
    expect(grids).toHaveLength(2);
    expect(grids[0]).not.toBe(grids[1]);
  });
});
