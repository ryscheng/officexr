import { useSyncExternalStore } from 'react';

export type MuteStorage = Pick<Storage, 'getItem' | 'setItem'>;

export type LocalMutes = {
  subscribe: (listener: () => void) => () => void;
  get: () => ReadonlySet<string>;
  toggle: (login: string) => void;
};

const KEY = 'officexr:muted-people';

function browserStorage(): MuteStorage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

function load(storage: MuteStorage | null): Set<string> {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(KEY) ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

/** People this device has muted, by login, so a mute follows them into every window and visit. */
export function createLocalMutes(storage: MuteStorage | null = browserStorage()): LocalMutes {
  let muted: ReadonlySet<string> = load(storage);
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    get: () => muted,
    toggle: (login) => {
      const next = new Set(muted);
      if (!next.delete(login)) {
        next.add(login);
      }
      muted = next;
      try {
        storage?.setItem(KEY, JSON.stringify([...next]));
      } catch {
        // The mute still holds for this visit.
      }
      listeners.forEach((listener) => listener());
    },
  };
}

export const useLocalMutes = (mutes: LocalMutes): ReadonlySet<string> => useSyncExternalStore(mutes.subscribe, mutes.get);
