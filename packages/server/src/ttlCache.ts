export interface TtlCacheOptions<T> {
  ttlMs: (value: T) => number;
  now?: () => number;
  maxEntries?: number;
}

export function createTtlCache<T>({ ttlMs, now = Date.now, maxEntries = 10_000 }: TtlCacheOptions<T>) {
  const entries = new Map<string, { value: T; expiresAt: number }>();
  const inFlight = new Map<string, Promise<T>>();
  const store = (key: string, value: T) => {
    const at = now();
    for (const [k, entry] of entries) {
      if (entry.expiresAt <= at) {
        entries.delete(k);
      }
    }
    for (const k of entries.keys()) {
      if (entries.size < maxEntries) {
        break;
      }
      entries.delete(k);
    }
    entries.set(key, { value, expiresAt: at + ttlMs(value) });
  };
  const peek = (key: string): { value: T } | undefined => {
    const entry = entries.get(key);
    return entry && entry.expiresAt > now() ? { value: entry.value } : undefined;
  };
  return {
    peek,
    async getOrLoad(key: string, load: () => Promise<T>): Promise<T> {
      const cached = peek(key);
      if (cached) {
        return cached.value;
      }
      const pending = inFlight.get(key);
      if (pending) {
        return pending;
      }
      const loading = load()
        .then((value) => {
          store(key, value);
          return value;
        })
        .finally(() => inFlight.delete(key));
      inFlight.set(key, loading);
      return loading;
    },
    set: store,
    delete(key: string): void {
      entries.delete(key);
    },
  };
}
