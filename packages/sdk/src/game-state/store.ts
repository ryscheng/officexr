import { createStore as createZustandStore } from 'zustand/vanilla';
import { subscribeWithSelector } from 'zustand/middleware';
import type { OfficeState, PlayerId } from './types.ts';

/**
 * Headless store interface — small enough that the renderer, HUD, and sync
 * engine can depend on it without importing zustand directly. The
 * implementation uses zustand/vanilla under the hood (no React coupling)
 * with the subscribeWithSelector middleware so per-slice subscribers only
 * fire when their selected slice actually changes.
 */
export interface Store {
  getState(): OfficeState;
  setState(updater: (s: OfficeState) => Partial<OfficeState>): void;
  /**
   * Selector subscription — listener is invoked only when the selected
   * slice changes (Object.is equality by default; pass a custom comparator
   * for shallow equality on objects/arrays).
   */
  subscribe<T>(
    selector: (s: OfficeState) => T,
    listener: (next: T, prev: T) => void,
    equals?: (a: T, b: T) => boolean,
  ): () => void;
  /** Listener invoked on every setState with (next, prev). */
  subscribeAll(listener: (next: OfficeState, prev: OfficeState) => void): () => void;
}

export function createInitialOfficeState(opts: {
  selfId: PlayerId;
  officeId: string;
}): OfficeState {
  return {
    selfId: opts.selfId,
    officeId: opts.officeId,
    players: {},
    proximity: {},
    chat: [],
    whiteboard: { strokes: [], cleared: 0 },
    zombies: {
      phase: 'idle',
      wave: 0,
      totalKills: 0,
      hostId: null,
      entities: {},
      playerHealths: {},
    },
    inventory: [],
    screenShares: {},
    realtime: { status: 'connecting', snapshotTarget: null, versionWarnings: {} },
    runtime: { tickRate: 60, lastTick: 0, protocolVersion: 1 },
  };
}

export function createStore(opts: { selfId: PlayerId; officeId: string }): Store {
  const z = createZustandStore<OfficeState>()(
    subscribeWithSelector(() => createInitialOfficeState(opts)),
  );

  return {
    getState: () => z.getState(),
    setState(updater) {
      z.setState((s) => updater(s));
    },
    subscribe(selector, listener, equals) {
      // zustand/vanilla's subscribeWithSelector signature:
      //   subscribe(selector, listener, options?)
      return z.subscribe(selector, listener, equals ? { equalityFn: equals } : undefined);
    },
    subscribeAll(listener) {
      // Subscribing without a selector fires on every setState with (state, prev).
      return z.subscribe(listener);
    },
  };
}
