export interface Cooldown {
  take: (key: string) => number;
  release: (key: string) => void;
}

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
