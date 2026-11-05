import type { Actions } from './actions.ts';
import type { Bus } from './bus.ts';
import type { RuleRegistry } from './rules.ts';
import type { Store } from './store.ts';
import type { OfficeState } from './types.ts';
import type { SyncEngine } from '../realtime/sync.ts';
import type { SnapshotHandshake } from '../realtime/snapshot-handshake.ts';

export interface SessionTickDeps {
  actions: Actions;
  store: Store;
  rules: RuleRegistry;
  bus: Bus;
  sync: SyncEngine;
  handshake: SnapshotHandshake;
  prevState: OfficeState;
  nowMs: number;
}

/** Runs one frame of non-render session work; returns the state to pass as `prevState` next frame. */
export function tickSession(deps: SessionTickDeps): OfficeState {
  const { actions, store, rules, bus, sync, handshake, prevState, nowMs } = deps;
  actions.tick(nowMs);
  rules.tick(store.getState(), prevState, bus);
  const next = store.getState();
  sync.flushPosition();
  handshake.tickTimers();
  return next;
}
