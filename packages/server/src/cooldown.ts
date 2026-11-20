export interface Cooldown {
  /** Starts the cooldown for `key` and returns 0, or returns the milliseconds left when it is still running. */
  take: (key: string) => number;
  /** Ends the cooldown early, for an action that did not go through. */
  release: (key: string) => void;
}

/** At most one action per key per `windowMs`. Expired keys are dropped as new ones arrive, so the map stays small. */
export function createCooldown(windowMs: number, now: () => number = Date.now): Cooldown {
  const startedAt = new Map<string, number>();
  return {
    take(key) {
      const at = now();
      const previous = startedAt.get(key);
      if (previous !== undefined && at - previous < windowMs) {
        return windowMs - (at - previous);
      }
      for (const [k, started] of startedAt) {
        if (at - started >= windowMs) {
          startedAt.delete(k);
        }
      }
      startedAt.set(key, at);
      return 0;
    },
    release(key) {
      startedAt.delete(key);
    },
  };
}
