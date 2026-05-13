import { createStore as createZustandStore } from 'zustand/vanilla';
import { subscribeWithSelector } from 'zustand/middleware';
import {
  DEFAULT_WORLD_MAP,
  DEFAULT_WORLD_OBJECTS,
  DEFAULT_WORLD_SETTINGS,
} from './types.ts';
import type { OfficeState, PlayerId } from './types.ts';
import { cloneWorldMap } from './world-map.ts';

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
    worldSettings: { ...DEFAULT_WORLD_SETTINGS },
    worldMap: cloneWorldMap(DEFAULT_WORLD_MAP),
    characterConfigs: {},
    worldObjects: {
      cubeSize: DEFAULT_WORLD_OBJECTS.cubeSize,
      instances: [...DEFAULT_WORLD_OBJECTS.instances],
    },
  };
}

export function createStore(opts: { selfId: PlayerId; officeId: string }): Store {
  const z = createZustandStore<OfficeState>()(
    subscribeWithSelector(() => createInitialOfficeState(opts)),
  );

  // zustand/vanilla iterates listeners with a plain forEach — if one throws,
  // later listeners don't fire. Wrap every subscriber in a try/catch at the
  // facade boundary so one badly-behaved consumer (e.g. a HUD selector
  // crashing on a stale slice) can't tear down the sync engine or the bus.
  function isolated<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
    return (...args: A) => {
      try {
        fn(...args);
      } catch (err) {
        console.error('[store] subscriber threw:', err);
      }
    };
  }

  return {
    getState: () => z.getState(),
    setState(updater) {
      z.setState((s) => updater(s));
    },
    subscribe(selector, listener, equals) {
      return z.subscribe(
        selector,
        isolated(listener as (...args: unknown[]) => void) as typeof listener,
        equals ? { equalityFn: equals } : undefined,
      );
    },
    subscribeAll(listener) {
      return z.subscribe(isolated(listener as (...args: unknown[]) => void) as typeof listener);
    },
  };
}
