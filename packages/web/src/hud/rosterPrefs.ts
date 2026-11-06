import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'officexr:roster';

export type RosterStorage = Pick<Storage, 'getItem' | 'setItem'>;

function rawPrefs(storage: Pick<Storage, 'getItem'>): string | null {
  try {
    return storage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

const parse = (raw: string | null) => (raw === 'collapsed' ? true : raw === 'open' ? false : null);

const listeners = new Set<() => void>();

function writeRosterCollapsed(storage: RosterStorage, collapsed: boolean): void {
  try {
    storage.setItem(STORAGE_KEY, collapsed ? 'collapsed' : 'open');
  } catch {
    // Unremembered choice: the next load falls back to the default.
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

/** Whether the roster is folded; `defaultCollapsed` applies until the user chooses. Re-renders on a write from any tab. */
export function useRosterCollapsed(
  defaultCollapsed: boolean,
  storage: RosterStorage = localStorage,
): [collapsed: boolean, setCollapsed: (collapsed: boolean) => void] {
  const raw = useSyncExternalStore(subscribe, () => rawPrefs(storage));
  return [parse(raw) ?? defaultCollapsed, (collapsed) => writeRosterCollapsed(storage, collapsed)];
}
