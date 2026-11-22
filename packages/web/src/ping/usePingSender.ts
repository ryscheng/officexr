import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { PlayerId } from '@officexr/sdk';
import { performanceNow } from '../hud/useNow';

const PING_COOLDOWN_MS = 5000;
export const INVITE_COOLDOWN_MS = 30_000;

export type PingSender = { ping: (id: PlayerId) => void; isCoolingDown: (id: PlayerId) => boolean };

/** Sends at most one ping per target per cooldown; re-renders when a cooldown ends. `clock` must be stable. */
export function usePingSender(send: (id: PlayerId) => void, clock: () => number = performanceNow, cooldownMs = PING_COOLDOWN_MS): PingSender {
  const pings = useRef(new Map<PlayerId, { at: number; timer: ReturnType<typeof setTimeout> }>());
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const pending = pings.current;
    return () => pending.forEach(({ timer }) => clearTimeout(timer));
  }, []);

  const isCoolingDown = useCallback(
    (id: PlayerId) => {
      const entry = pings.current.get(id);
      return entry !== undefined && clock() - entry.at < cooldownMs;
    },
    [clock, cooldownMs],
  );

  const ping = useCallback(
    (id: PlayerId) => {
      if (isCoolingDown(id)) {
        return;
      }
      const at = clock();
      // A timer that fires before the clock says the cooldown is over waits out the remainder.
      const wait = (ms: number): ReturnType<typeof setTimeout> =>
        setTimeout(() => {
          if (isCoolingDown(id)) {
            pings.current.set(id, { at, timer: wait(at + cooldownMs - clock()) });
          } else {
            pings.current.delete(id);
          }
          rerender();
        }, ms);
      pings.current.set(id, { at, timer: wait(cooldownMs) });
      send(id);
      rerender();
    },
    [send, clock, cooldownMs, isCoolingDown],
  );

  return { ping, isCoolingDown };
}
