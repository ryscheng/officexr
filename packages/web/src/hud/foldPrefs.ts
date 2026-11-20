import { useCallback, useSyncExternalStore } from 'react';

export type FoldStorage = Pick<Storage, 'getItem' | 'setItem'>;

const PREFIX = 'officexr:fold:';
const NO_STORAGE: FoldStorage = {
  getItem: () => null,
  setItem: () => {
    throw new Error('storage unavailable');
  },
};

function browserStorage(): FoldStorage {
  try {
    return localStorage;
  } catch {
    return NO_STORAGE;
  }
}

const parse = (raw: string | null) => (raw === 'folded' ? true : raw === 'open' ? false : null);

const listeners = new Set<() => void>();
// A choice the storage refused stays for the rest of the session.
const unsaved = new WeakMap<FoldStorage, Map<string, string>>();

function read(storage: FoldStorage, key: string): string | null {
  const held = unsaved.get(storage)?.get(key);
  if (held !== undefined) {
    return held;
  }
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function write(storage: FoldStorage, key: string, folded: boolean): void {
  const value = folded ? 'folded' : 'open';
  try {
    storage.setItem(key, value);
    unsaved.get(storage)?.delete(key);
  } catch {
    const held = unsaved.get(storage) ?? new Map<string, string>();
    held.set(key, value);
    unsaved.set(storage, held);
  }
  listeners.forEach((listener) => listener());
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener('storage', onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

export type Fold = { folded: boolean; setFolded: (folded: boolean) => void; toggle: () => void };

export function useFold(name: string, defaultFolded: boolean, storage: FoldStorage = browserStorage()): Fold {
  const key = `${PREFIX}${name}`;
  const raw = useSyncExternalStore(subscribe, () => read(storage, key));
  const folded = parse(raw) ?? defaultFolded;
  const setFolded = useCallback((next: boolean) => write(storage, key, next), [storage, key]);
  const toggle = useCallback(() => write(storage, key, !folded), [storage, key, folded]);
  return { folded, setFolded, toggle };
}
