import type { OfficeState, PlayerId } from './types.ts';

export interface Store {
  getState(): OfficeState;
  setState(updater: (s: OfficeState) => Partial<OfficeState>): void;
  subscribe<T>(
    selector: (s: OfficeState) => T,
    listener: (next: T, prev: T) => void,
    equals?: (a: T, b: T) => boolean,
  ): () => void;
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
  let state: OfficeState = createInitialOfficeState(opts);
  type AnyListener = (next: OfficeState, prev: OfficeState) => void;
  const allListeners = new Set<AnyListener>();

  return {
    getState: () => state,

    setState(updater) {
      const prev = state;
      const patch = updater(state);
      // Shallow merge; nested data is updater's responsibility.
      state = { ...state, ...patch };
      // Snapshot listeners so unsubscribe-during-emit is safe.
      for (const listener of [...allListeners]) {
        try {
          listener(state, prev);
        } catch (err) {
          console.error('[store] listener threw:', err);
        }
      }
    },

    subscribe(selector, listener, equals = Object.is) {
      let lastValue = selector(state);
      const wrapped: AnyListener = (next, prev) => {
        const nextValue = selector(next);
        if (!equals(nextValue, lastValue)) {
          const prevValue = lastValue;
          lastValue = nextValue;
          listener(nextValue, prevValue);
        }
      };
      allListeners.add(wrapped);
      return () => {
        allListeners.delete(wrapped);
      };
    },

    subscribeAll(listener) {
      allListeners.add(listener);
      return () => {
        allListeners.delete(listener);
      };
    },
  };
}
