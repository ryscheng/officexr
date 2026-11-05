import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SoundCatalogEntry } from '@officexr/world/app';
import { useTestStorages } from '../../test-harness/TestStorageContext.tsx';
import { HttpSoundLibraryStorage, type SoundLibraryStorage } from './soundLibraryStorage.ts';

export interface UseSoundLibraryResult {
  sounds: readonly SoundCatalogEntry[];
  loading: boolean;
  busy: boolean;
  error: string | null;
  upload: (name: string, bytes: Uint8Array<ArrayBuffer>) => Promise<void>;
  remove: (name: string) => Promise<void>;
  url: (name: string) => string;
}

/** Storage resolves as explicit option, then the `?test=1` context, then HTTP. */
export function useSoundLibrary(opts: { storage?: SoundLibraryStorage } = {}): UseSoundLibraryResult {
  const testStorage = useTestStorages()?.soundStorage;
  const storage = useMemo(
    () => opts.storage ?? testStorage ?? new HttpSoundLibraryStorage(),
    [opts.storage, testStorage],
  );
  const [sounds, setSounds] = useState<readonly SoundCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (op: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await op();
      setSounds((await storage.list()).sounds);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setLoading(false);
    }
  }, [storage]);

  useEffect(() => {
    void run(async () => {});
  }, [run]);

  return {
    sounds,
    loading,
    busy,
    error,
    upload: useCallback((name, bytes) => run(() => storage.put(name, bytes)), [run, storage]),
    remove: useCallback((name) => run(() => storage.remove(name)), [run, storage]),
    url: storage.url.bind(storage),
  };
}
