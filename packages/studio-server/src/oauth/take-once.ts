/** Values that can be taken out once, before they expire; expired ones are dropped as new ones arrive. */
export class TakeOnce<V> {
  private readonly entries = new Map<string, { value: V; expires: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => Date,
  ) {}

  put(key: string, value: V) {
    const now = this.now().getTime();
    for (const [k, entry] of this.entries) {
      if (entry.expires <= now) {
        this.entries.delete(k);
      }
    }
    this.entries.set(key, { value, expires: now + this.ttlMs });
  }

  take(key: string): V | null {
    const entry = this.entries.get(key);
    this.entries.delete(key);
    return entry && entry.expires > this.now().getTime() ? entry.value : null;
  }
}
