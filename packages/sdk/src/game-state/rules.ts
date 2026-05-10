import type { Bus } from './bus.ts';
import type { OfficeState } from './types.ts';
import { PlayerGrid } from '../spatial/player-grid.ts';
import {
  DEFAULT_COLLISION_MATRIX,
  type CollisionMatrix,
  type MaterialId,
} from '../collision/materials.ts';
import {
  runCollisionPass,
  type CollisionEvent,
} from '../collision/pass.ts';

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

/**
 * Event rules respond to {@link CollisionEvent}s produced by the per-tick
 * collision pass. The pass runs deterministically over broadcast state, so
 * event rules behave identically on every peer that sees the same `state`
 * + `prev`.
 */
export interface EventRule {
  kind: 'event';
  /** Material pair filter. The rule fires only for events whose
   * `(a.material, b.material)` matches (in either order). Omit to receive
   * every event. */
  pair?: [MaterialId, MaterialId];
  /** Event-kind filter. Omit to receive both `entered` and `exited`. */
  on?: ReadonlyArray<CollisionEvent['kind']>;
  fn: (event: CollisionEvent, state: OfficeState, bus: Bus) => void;
}

export type Rule = TickRule | EventRule;

export interface RuleRegistry {
  /** Register a rule. Returns an unsubscribe handle. */
  addRule(rule: Rule): () => void;
  /** Advance one tick: build the shared {@link TickContext}, run the
   * collision pass, dispatch events to event rules, then invoke each tick
   * rule whose frequency divides the counter. */
  tick(state: OfficeState, prev: OfficeState, bus: Bus): void;
}

export interface RuleRegistryOptions {
  /** Collision matrix used by the per-tick collision pass. Defaults to
   * {@link DEFAULT_COLLISION_MATRIX}. Apps that introduce new materials
   * pass an extended matrix here. */
  matrix?: CollisionMatrix;
}

export function createRuleRegistry(
  options: RuleRegistryOptions = {},
): RuleRegistry {
  const matrix = options.matrix ?? DEFAULT_COLLISION_MATRIX;
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
      const events = runCollisionPass(state, prev, matrix);

      for (const rule of rules.slice()) {
        try {
          if (rule.kind === 'tick') {
            const freq = rule.frequency ?? 1;
            if (freq > 1 && tickCount % freq !== 0) continue;
            rule.fn(state, prev, bus, ctx);
          } else {
            // event rule — dispatch only matching events
            for (const event of events) {
              if (rule.on && !rule.on.includes(event.kind)) continue;
              if (rule.pair && !pairMatches(event, rule.pair)) continue;
              rule.fn(event, state, bus);
            }
          }
        } catch (err) {
          console.error('[rules] rule threw during tick:', err);
        }
      }
    },
  };
}

function pairMatches(
  event: CollisionEvent,
  pair: [MaterialId, MaterialId],
): boolean {
  const [m1, m2] = pair;
  const a = event.a.material;
  const b = event.b.material;
  return (a === m1 && b === m2) || (a === m2 && b === m1);
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
