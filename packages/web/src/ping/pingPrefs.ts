import { useMemo, useSyncExternalStore } from 'react';

export type PingSound = { type: 'builtin' } | { type: 'library'; name: string } | { type: 'none' };
export type PingPrefs = { sound: PingSound; notify: boolean };

export const DEFAULT_PING_PREFS: PingPrefs = { sound: { type: 'builtin' }, notify: false };

const STORAGE_KEY = 'officexr:ping';

type PrefsStorage = Pick<Storage, 'getItem' | 'setItem'>;

function parseSound(value: unknown): PingSound | null {
  const sound = value as { type?: unknown; name?: unknown } | null;
  if (sound?.type === 'builtin' || sound?.type === 'none') {
    return { type: sound.type };
  }
  if (sound?.type === 'library' && typeof sound.name === 'string' && sound.name !== '') {
    return { type: 'library', name: sound.name };
  }
  return null;
}

function parsePingPrefs(raw: string | null): PingPrefs {
  try {
    const parsed = JSON.parse(raw ?? 'null') as { sound?: unknown; notify?: unknown } | null;
    return {
      sound: parseSound(parsed?.sound) ?? DEFAULT_PING_PREFS.sound,
      notify: parsed?.notify === true,
    };
  } catch {
    return DEFAULT_PING_PREFS;
  }
}

function rawPrefs(storage: Pick<Storage, 'getItem'>): string | null {
  try {
    return storage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function readPingPrefs(storage: Pick<Storage, 'getItem'> = localStorage): PingPrefs {
  return parsePingPrefs(rawPrefs(storage));
}

const listeners = new Set<() => void>();

export function writePingPrefs(storage: PrefsStorage, prefs: PingPrefs): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Unremembered choice: the next load falls back to defaults.
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

/** Current prefs; re-renders on a write from this tab or another. */
export function usePingPrefs(): PingPrefs {
  const raw = useSyncExternalStore(subscribe, () => rawPrefs(localStorage));
  return useMemo(() => parsePingPrefs(raw), [raw]);
}
