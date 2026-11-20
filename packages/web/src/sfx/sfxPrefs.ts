import { useMemo, useSyncExternalStore } from 'react';
import type { SfxSettings } from '@officexr/world/audio';

export const DEFAULT_SFX_PREFS: SfxSettings = { enabled: true, volume: 0.7 };

const STORAGE_KEY = 'officexr:sfx';

type PrefsStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function parseSfxPrefs(raw: string | null): SfxSettings {
  try {
    const parsed = JSON.parse(raw ?? 'null') as { enabled?: unknown; volume?: unknown } | null;
    const volume = typeof parsed?.volume === 'number' && Number.isFinite(parsed.volume) ? Math.max(0, Math.min(1, parsed.volume)) : DEFAULT_SFX_PREFS.volume;
    return { enabled: parsed?.enabled !== false, volume };
  } catch {
    return DEFAULT_SFX_PREFS;
  }
}

function rawPrefs(storage: Pick<Storage, 'getItem'>): string | null {
  try {
    return storage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export const readSfxPrefs = (storage: Pick<Storage, 'getItem'>): SfxSettings => parseSfxPrefs(rawPrefs(storage));

const listeners = new Set<() => void>();

export function writeSfxPrefs(storage: PrefsStorage, prefs: SfxSettings): void {
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

export function useSfxPrefs(): SfxSettings {
  const raw = useSyncExternalStore(subscribe, () => rawPrefs(localStorage));
  return useMemo(() => parseSfxPrefs(raw), [raw]);
}
