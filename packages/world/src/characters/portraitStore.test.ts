import { describe, expect, it } from 'vitest';
import { createPortraitStore } from './portraitStore.ts';

type Listener = (() => void) | null;

function fakeFactory(rows: Map<string, unknown>, failOpen = false): IDBFactory {
  const request = <T>(result: T): IDBRequest<T> => {
    const r = { result, error: null, onsuccess: null as Listener, onerror: null as Listener } as unknown as IDBRequest<T>;
    queueMicrotask(() => (r.onsuccess as Listener)?.());
    return r;
  };
  const objectStore = {
    get: (key: string) => request(rows.get(key)),
    put: (value: unknown, key: string) => {
      rows.set(key, value);
      return request(key);
    },
  };
  const db = { transaction: () => ({ objectStore: () => objectStore }), createObjectStore: () => objectStore };
  return {
    open: () => {
      const r = { result: db, error: new Error('blocked'), onsuccess: null as Listener, onerror: null as Listener, onupgradeneeded: null as Listener };
      queueMicrotask(() => ((failOpen ? r.onerror : r.onsuccess) as Listener)?.());
      return r;
    },
  } as unknown as IDBFactory;
}

describe('portrait store', () => {
  it('reads back what it wrote', async () => {
    const store = createPortraitStore(fakeFactory(new Map()));
    expect(await store.read('/models/a.glb')).toBeNull();
    await store.write('/models/a.glb', 'data:image/png;base64,AAA');
    expect(await store.read('/models/a.glb')).toBe('data:image/png;base64,AAA');
  });

  it('keys rows by version and url', async () => {
    const rows = new Map<string, unknown>();
    await createPortraitStore(fakeFactory(rows)).write('/models/a.glb', 'x');
    expect([...rows.keys()]).toEqual(['1:/models/a.glb']);
  });

  it('reads as a miss and skips writes when storage is missing or blocked', async () => {
    for (const store of [createPortraitStore(undefined), createPortraitStore(fakeFactory(new Map(), true))]) {
      await store.write('/models/a.glb', 'x');
      expect(await store.read('/models/a.glb')).toBeNull();
    }
  });
});
