import type { Bus } from './bus.ts';
import type { OfficeState } from './types.ts';
import { PlayerGrid } from '../spatial/player-grid.ts';

/**
 * Per-tick context shared across rules. Today this is just a memoised
 * spatial index of player positions — built once per tick and queried by
 * any rule that wants O(neighbours) instead of O(N) pair scans. Keyed by
 * cell size so two rules requesting the same size share one build.
 */
export interface TickContext {
  /** Returns a player-position spatial grid with the requested cell size,
   * built lazily and memoised for the rest of this tick. Pick `cellSize`
   * to be at least the maximum query radius the caller will use. */
  getPlayerGrid(cellSize: number): PlayerGrid;
}

/** Tick rules run synchronously every `frequency`-th tick of the registry. */
export interface TickRule {
  kind: 'tick';
  /** Run when `tickCount % frequency === 0`. Default 1 (every tick). */
  frequency?: number;
  fn: (
    state: OfficeState,
    prev: OfficeState,
    bus: Bus,
    ctx: TickContext,
  ) => void;
}

export type Rule = TickRule;

export interface RuleRegistry {
  /** Register a rule. Returns an unsubscribe handle. */
  addRule(rule: Rule): () => void;
  /** Advance one tick: build the shared {@link TickContext}, then invoke
   * each tick rule whose frequency divides the counter. */
  tick(state: OfficeState, prev: OfficeState, bus: Bus): void;
}

export function createRuleRegistry(): RuleRegistry {
  const rules: Rule[] = [];
  let tickCount = 0;

  return {
    addRule(rule) {
      rules.push(rule);
      return () => {
        const i = rules.indexOf(rule);
        if (i >= 0) rules.splice(i, 1);
      };
    },
    tick(state, prev, bus) {
      tickCount++;
      const ctx = makeTickContext(state);

      for (const rule of rules.slice()) {
        try {
          const freq = rule.frequency ?? 1;
          if (freq > 1 && tickCount % freq !== 0) continue;
          rule.fn(state, prev, bus, ctx);
        } catch (err) {
          console.error('[rules] rule threw during tick:', err);
        }
      }
    },
  };
}

function makeTickContext(state: OfficeState): TickContext {
  const grids = new Map<number, PlayerGrid>();
  return {
    getPlayerGrid(cellSize) {
      let g = grids.get(cellSize);
      if (!g) {
        g = PlayerGrid.fromPlayers(state.players, cellSize);
        grids.set(cellSize, g);
      }
      return g;
    },
  };
}
