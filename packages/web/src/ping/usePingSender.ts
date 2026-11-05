import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { PlayerId } from '@officexr/sdk';

export const PING_COOLDOWN_MS = 5000;

const performanceNow = () => performance.now();

export type PingSender = { ping: (id: PlayerId) => void; isCoolingDown: (id: PlayerId) => boolean };

/** Sends at most one ping per target per cooldown; re-renders when a cooldown ends. `send` and `clock` must be stable. */
export function usePingSender(send: (id: PlayerId) => void, clock: () => number = performanceNow): PingSender {
  const lastSent = useRef(new Map<PlayerId, number>());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const isCoolingDown = useCallback(
    (id: PlayerId) => {
      const at = lastSent.current.get(id);
      return at !== undefined && clock() - at < PING_COOLDOWN_MS;
    },
    [clock],
  );

  const ping = useCallback(
    (id: PlayerId) => {
      if (isCoolingDown(id)) {
        return;
      }
      lastSent.current.set(id, clock());
      send(id);
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        rerender();
      }, PING_COOLDOWN_MS);
      timers.current.add(timer);
      rerender();
    },
    [send, clock, isCoolingDown],
  );

  return { ping, isCoolingDown };
}
