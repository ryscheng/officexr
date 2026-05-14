import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_VIEW_CONFIG, type ViewConfig } from './types.ts';

const STORAGE_KEY = 'officexr:studio:view-config';
const FLUSH_MS = 250;

export interface UseStudioSettingsResult {
  /** The active view-config. Always non-null. */
  viewConfig: ViewConfig;
  /** Update a single section (replaces the section's fields with the
   *  caller's patch). The other sections are left alone. */
  setSection: <K extends keyof ViewConfig>(
    key: K,
    update: (prev: ViewConfig[K]) => ViewConfig[K],
  ) => void;
  /** Restore every field to its bundled default + clear localStorage. */
  reset: () => void;
  /** Download the current viewConfig as JSON (Settings panel button). */
  exportJson: () => void;
}

/**
 * Replaces the previous whole-store roundtrip with a single
 * explicit React-state bag for the world-renderer panel values.
 * Persists to localStorage (debounced 250 ms) and re-hydrates on
 * mount.
 *
 * The shape is `ViewConfig`, partitioned by panel; the panels use
 * `setSection('proximity', prev => ({...prev, discRadius: v}))` to
 * apply edits. Every update is structurally a new ViewConfig object,
 * so consumers using shallow comparison (e.g. `<Scene>`'s memo'd
 * shadowCam) re-derive correctly.
 */
export function useStudioSettings(): UseStudioSettingsResult {
  const [viewConfig, setViewConfig] = useState<ViewConfig>(() => {
    if (typeof localStorage === 'undefined') return DEFAULT_VIEW_CONFIG;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return DEFAULT_VIEW_CONFIG;
      const parsed = JSON.parse(saved) as Partial<ViewConfig>;
      // Shallow-merge per section so we add any new defaults that
      // appeared since the last save (e.g. a new field added).
      return mergeViewConfig(DEFAULT_VIEW_CONFIG, parsed);
    } catch (err) {
      console.warn('[studio-settings] hydrate failed:', err);
      return DEFAULT_VIEW_CONFIG;
    }
  });

  // Debounced writer. Only fires after the user has stopped editing
  // for FLUSH_MS so a slider drag doesn't hammer localStorage.
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (pendingRef.current) clearTimeout(pendingRef.current);
    pendingRef.current = setTimeout(() => {
      pendingRef.current = null;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(viewConfig));
      } catch (err) {
        console.warn('[studio-settings] persist failed:', err);
      }
    }, FLUSH_MS);
    return () => {
      if (pendingRef.current) {
        clearTimeout(pendingRef.current);
        pendingRef.current = null;
      }
    };
  }, [viewConfig]);

  const setSection = useCallback(
    <K extends keyof ViewConfig>(
      key: K,
      update: (prev: ViewConfig[K]) => ViewConfig[K],
    ) => {
      setViewConfig((prev) => ({ ...prev, [key]: update(prev[key]) }));
    },
    [],
  );

  const reset = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore.
    }
    setViewConfig(DEFAULT_VIEW_CONFIG);
  }, []);

  const exportJson = useCallback(() => {
    const json = JSON.stringify(viewConfig, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `studio-view-config-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [viewConfig]);

  return useMemo(
    () => ({ viewConfig, setSection, reset, exportJson }),
    [viewConfig, setSection, reset, exportJson],
  );
}

function mergeViewConfig(
  base: ViewConfig,
  patch: Partial<ViewConfig>,
): ViewConfig {
  // Per-section shallow merge so a field added since the last save
  // (e.g. a new ambientIntensity slider) picks up the bundled default
  // instead of being undefined. Cast through `Record<string, unknown>`
  // because the section types are unrelated unions — TypeScript can't
  // see that `key` constrains both sides.
  const out: Record<string, unknown> = { ...(base as unknown as Record<string, unknown>) };
  for (const key of Object.keys(patch)) {
    const baseSection = (base as unknown as Record<string, unknown>)[key];
    const patchSection = (patch as unknown as Record<string, unknown>)[key];
    if (
      baseSection &&
      patchSection &&
      typeof baseSection === 'object' &&
      typeof patchSection === 'object' &&
      !Array.isArray(patchSection)
    ) {
      out[key] = { ...(baseSection as object), ...(patchSection as object) };
    }
  }
  return out as unknown as ViewConfig;
}
