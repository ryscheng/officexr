import { useEffect, useReducer } from 'react';
// Node's strict ESM loader requires the `with { type: 'json' }`
// attribute for JSON modules. Vite, esbuild, and TypeScript 5.3+ all
// pass it through unchanged for browser bundles.
import defaultCatalogJson from '../../world-object-kinds.default.json' with { type: 'json' };
import {
  validateWorldObjectKindCatalog,
  type WorldObjectKindCatalogV1,
  type WorldObjectKind,
} from './world-object-kinds-schema.ts';

/**
 * In-memory store for the world-object-kind catalog.
 *
 * Bootstrap flow:
 *   1. Module load: `current` = the bundled default JSON. This keeps
 *      everything (preloads, palettes, rendering) working before any
 *      network round-trip — there's no "no-catalog" intermediate state.
 *   2. First `useObjectKindCatalog()` call kicks off `bootstrapCatalog()`,
 *      which fetches `/api/world-object-kinds` and replaces `current` with the
 *      validated payload. Subscribers re-render.
 *   3. The Object editor calls `replaceCatalog()` after the
 *      user edits a kind; the same subscriber list fires so live
 *      previews update.
 *
 * Bootstrap failures fall back to the bundled default with a warning;
 * the renderer keeps rendering, just without the user's authored
 * edits. This matches the broader "studio still works offline" stance.
 */

let current: WorldObjectKindCatalogV1 = validateWorldObjectKindCatalog(defaultCatalogJson);
let bootstrapped = false;
let bootstrapPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function getCatalog(): WorldObjectKindCatalogV1 {
  return current;
}

export function listKinds(): readonly WorldObjectKind[] {
  return current.kinds;
}

export function getKind(id: string): WorldObjectKind | undefined {
  return current.kinds.find((k) => k.id === id);
}

export function subscribeCatalog(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function replaceCatalog(next: WorldObjectKindCatalogV1): void {
  current = next;
  for (const l of listeners) l();
}

/** Patch a single kind's fields in-place. Used by the Object editor
 * to apply a tweak without rewriting the entire catalog
 * each time. Returns the new catalog so callers (the studio's
 * auto-save) can persist it. */
export function patchKind(
  id: string,
  partial: Partial<WorldObjectKind>,
): WorldObjectKindCatalogV1 {
  const next: WorldObjectKindCatalogV1 = {
    ...current,
    updatedAt: Date.now(),
    kinds: current.kinds.map((k) => (k.id === id ? { ...k, ...partial } : k)),
  };
  replaceCatalog(next);
  return next;
}

/** Reset to the bundled default. Used by tests and the Object editor's
 * "reset" button. Does NOT touch the server-side catalog file. */
export function resetCatalogToDefault(): void {
  current = validateWorldObjectKindCatalog(defaultCatalogJson);
  for (const l of listeners) l();
}

/** Fetches `/api/world-object-kinds` and replaces the in-memory catalog. Safe
 * to call repeatedly — only the first call actually fetches; later
 * calls return the cached promise. Failures log + keep the bundled
 * default so the renderer never has a "no catalog" frame. */
export async function bootstrapCatalog(
  opts: { basePath?: string } = {},
): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise;
  const base = (opts.basePath ?? '/api/world-object-kinds').replace(/\/$/, '');
  bootstrapPromise = (async () => {
    try {
      const r = await fetch(base);
      if (!r.ok) throw new Error(`bootstrap status ${r.status}`);
      const json = (await r.json()) as unknown;
      const validated = validateWorldObjectKindCatalog(json);
      replaceCatalog(validated);
    } catch (err) {
      console.warn('[object-kind-catalog] bootstrap fallback to bundled default:', err);
    } finally {
      bootstrapped = true;
    }
  })();
  return bootstrapPromise;
}

/** Test helper: clear bootstrap memoization so a subsequent test can
 * exercise the fetch path with a different mock. Never call from
 * production code. */
export function __resetBootstrapForTests(): void {
  bootstrapped = false;
  bootstrapPromise = null;
  resetCatalogToDefault();
}

/** React hook: returns the live list of kinds and re-renders the
 * caller when the catalog changes. The first call from the React tree
 * triggers `bootstrapCatalog()` if it hasn't fired yet, so callers
 * don't have to remember to wire it from their app root. */
export function useObjectKindCatalog(): readonly WorldObjectKind[] {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => subscribeCatalog(force), []);
  useEffect(() => {
    if (!bootstrapped) {
      void bootstrapCatalog();
    }
  }, []);
  return current.kinds;
}

// ---------------------------------------------------------------------------
// Back-compat aliases for code that still uses the old cube-catalog names.
// These will be removed once all callers are migrated.
// ---------------------------------------------------------------------------

/** @deprecated Use useObjectKindCatalog */
export const useCubeCatalog = useObjectKindCatalog;
