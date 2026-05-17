import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FilesystemCatalogStorage,
  getCatalog,
  getKind,
  patchKind,
  useObjectKindCatalog,
  type WorldObjectKindCatalogV1,
  type WorldObjectKind,
} from '@officexr/world';

/**
 * Studio-side wrapper around the world's catalog store. Adds:
 *   - A selected-kind state (drives the Object editor's preview +
 *     Leva binding).
 *   - `applyPatch(partial)` — applies a Leva slider tweak to the
 *     currently-selected kind via `patchKind`, which mutates the
 *     in-memory store + notifies subscribers (so the Room editor's
 *     palette + ObjectInstances re-render live).
 *   - Auto-save to /api/world-object-kinds via FilesystemCatalogStorage,
 *     debounced 500ms so a slider drag doesn't fire one PUT per
 *     frame.
 *
 * No coupling to React beyond `useState` + `useEffect`. The world's
 * `useCubeCatalog` is what triggers re-renders when the catalog
 * changes.
 */
export interface UseObjectCatalogResult {
  kinds: readonly WorldObjectKind[];
  selectedKindId: string | null;
  selectedKind: WorldObjectKind | null;
  setSelectedKindId: (id: string | null) => void;
  applyPatch: (partial: Partial<WorldObjectKind>) => void;
}

const LAST_KIND_KEY = 'officexr:studio:lastObjectKind';

export function useObjectCatalog(): UseObjectCatalogResult {
  // Drives re-renders when the catalog changes and kicks off the
  // /api/world-object-kinds fetch on first mount.
  const kinds = useObjectKindCatalog();

  const [selectedKindId, setSelectedKindIdState] = useState<string | null>(
    () => {
      try {
        return globalThis.localStorage?.getItem(LAST_KIND_KEY) ?? null;
      } catch {
        return null;
      }
    },
  );

  // If the persisted id is no longer in the catalog (e.g. after a
  // catalog reset), fall back to the first kind once we have one.
  useEffect(() => {
    if (kinds.length === 0) return;
    if (selectedKindId && kinds.some((k) => k.id === selectedKindId)) return;
    setSelectedKindIdState(kinds[0].id);
  }, [kinds, selectedKindId]);

  const setSelectedKindId = useCallback((id: string | null) => {
    setSelectedKindIdState(id);
    try {
      if (id) globalThis.localStorage?.setItem(LAST_KIND_KEY, id);
      else globalThis.localStorage?.removeItem(LAST_KIND_KEY);
    } catch {
      // ignore — localStorage may be blocked.
    }
  }, []);

  const selectedKind = useMemo(() => {
    if (!selectedKindId) return null;
    return kinds.find((k) => k.id === selectedKindId) ?? null;
  }, [kinds, selectedKindId]);

  // Auto-save. Patches go into the in-memory store synchronously
  // (so the live preview updates immediately); a 500ms debounce
  // batches the PUTs.
  const storage = useMemo(() => {
    try {
      return new FilesystemCatalogStorage();
    } catch {
      return null;
    }
  }, []);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSave = useRef<WorldObjectKindCatalogV1 | null>(null);

  const scheduleSave = useCallback(() => {
    if (!storage) return;
    pendingSave.current = getCatalog();
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const c = pendingSave.current;
      pendingSave.current = null;
      saveTimer.current = null;
      if (!c) return;
      storage.save(c).catch((err) => {
        console.warn('[object-catalog] save failed:', err);
      });
    }, 500);
  }, [storage]);

  // Flush any pending save on unmount so a quick edit + tab away
  // doesn't lose work.
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        if (pendingSave.current && storage) {
          void storage.save(pendingSave.current);
        }
      }
    };
  }, [storage]);

  const applyPatch = useCallback(
    (partial: Partial<WorldObjectKind>) => {
      if (!selectedKindId) return;
      // The `id` field is the primary key — guard against an
      // accidental Leva field that tries to rename it.
      const safe: Partial<WorldObjectKind> = { ...partial };
      delete safe.id;
      const current = getKind(selectedKindId);
      if (!current) return;
      // Skip no-op patches so we don't trigger save churn when Leva
      // fires onChange with the same value the user just typed.
      const currentRecord = current as unknown as Record<string, unknown>;
      const changed = Object.entries(safe).some(
        ([key, value]) => currentRecord[key] !== value,
      );
      if (!changed) return;
      patchKind(selectedKindId, safe);
      scheduleSave();
    },
    [selectedKindId, scheduleSave],
  );

  return {
    kinds,
    selectedKindId,
    selectedKind,
    setSelectedKindId,
    applyPatch,
  };
}
