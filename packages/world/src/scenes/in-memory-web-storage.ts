/**
 * A `Storage`-interface shim backed by a plain `Map`. Lets the
 * localStorage-backed storage classes run in a hermetic test (or any
 * non-browser) environment without touching `globalThis.localStorage`.
 *
 * This is the substrate the `InMemory*Storage` classes compose, which
 * is why they're guaranteed to behave identically to their
 * `LocalStorage*Storage` counterparts — they ARE that code path, just
 * over a Map instead of the browser's Storage.
 */
export class MemoryWebStorage implements Storage {
  private data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null;
  }
}

export function createMemoryWebStorage(): Storage {
  return new MemoryWebStorage();
}
