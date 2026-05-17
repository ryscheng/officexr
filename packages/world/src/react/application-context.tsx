/**
 * React inversion-of-control for the Application Layer.
 *
 * Components consume `ApplicationApi` through this context — never via
 * module-level singletons. Tests + headless harnesses provide their own
 * `ApplicationApi` (real or mocked) at the provider boundary.
 *
 * Derived hooks (`useCatalog`, `useCatalogReady`, `useKind`,
 * `useInstanceAABB`, …) subscribe to the catalog's listeners via
 * `useSyncExternalStore` — React-19's idiom for external mutable
 * stores. This handles Concurrent Mode + Strict-Mode double-mounts
 * correctly and re-renders consumers exactly when `replaceCatalog`
 * or `patchKind` fires.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import type {
  ApplicationApi,
  CatalogService,
  Vec3,
  WorldAABB,
} from '../app/types.ts';
import type { WorldObjectKind } from '../scenes/world-object-kinds-schema.ts';

const ApplicationContext = createContext<ApplicationApi | null>(null);

export interface ApplicationProviderProps {
  api: ApplicationApi;
  children: React.ReactNode;
}

/**
 * Wraps a React subtree with an `ApplicationApi`. Production studio
 * passes the result of `createDefaultApi({ loadGltf })`; tests pass a
 * hand-rolled mock so no network / no THREE is needed.
 */
export function ApplicationProvider({ api, children }: ApplicationProviderProps) {
  return (
    <ApplicationContext.Provider value={api}>{children}</ApplicationContext.Provider>
  );
}

/**
 * Read the live `ApplicationApi`. Throws if called outside an
 * `<ApplicationProvider>`. The exception is deliberate — silent
 * "no provider" defaults made tests fail in confusing ways.
 */
export function useApplication(): ApplicationApi {
  const ctx = useContext(ApplicationContext);
  if (!ctx) {
    throw new Error(
      'useApplication: no <ApplicationProvider> in the tree. Wrap your app root.',
    );
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// useSyncExternalStore plumbing
// ---------------------------------------------------------------------------

/** Wrap a CatalogService as a useSyncExternalStore source. */
function useCatalogSnapshot<T>(
  catalog: CatalogService,
  read: (catalog: CatalogService) => T,
): T {
  const subscribe = useCallback(
    (notify: () => void) => catalog.subscribe(notify),
    [catalog],
  );
  const getSnapshot = useCallback(() => read(catalog), [catalog, read]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ---------------------------------------------------------------------------
// Derived hooks
// ---------------------------------------------------------------------------

const readListKinds = (c: CatalogService) => c.listKinds();

/** Subscribe to catalog changes and return the live list of kinds. */
export function useCatalog(): readonly WorldObjectKind[] {
  const api = useApplication();
  return useCatalogSnapshot(api.catalog, readListKinds);
}

/**
 * Returns `true` once the catalog bootstrap fetch has resolved (or
 * fallen back to the bundled default on error). Use to gate any
 * compile-time consumer of `kind.dimensions` so the first paint
 * doesn't see `[1,1,1]` stride fallbacks.
 */
export function useCatalogReady(): boolean {
  const api = useApplication();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void api.catalog.ready().then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [api.catalog]);
  return ready;
}

/** Look up a single kind by id; re-renders on catalog changes. */
export function useKind(id: string | null | undefined): WorldObjectKind | undefined {
  const api = useApplication();
  const read = useCallback(
    (c: CatalogService) => (id ? c.getKind(id) : undefined),
    [id],
  );
  return useCatalogSnapshot(api.catalog, read);
}

/**
 * Compute an instance's world AABB. Reads via the geometry service so
 * the result respects the canonical convention and reflects live
 * `kind.dimensions` edits from the Object editor.
 *
 * Implementation: subscribe to the catalog (so we re-render when any
 * `patchKind` / `replaceCatalog` fires) and re-memoise the AABB
 * against (position, kindId, catalog snapshot reference). The
 * `getCatalog()` reference changes on every notification because
 * `replaceCatalog` swaps the object — using it as a memo key means
 * the AABB recomputes on live dimension edits.
 *
 * Cannot use plain `useSyncExternalStore` here because each call to
 * `geometry.worldAABB(...)` allocates a fresh `{min, max}` object;
 * uSES would warn about returning non-identity-stable snapshots.
 */
export function useInstanceAABB(position: Vec3, kindId: string): WorldAABB {
  const api = useApplication();
  // Re-render trigger: subscribe to the catalog and recompute on
  // every notification.
  const catalogSnapshot = useCatalogSnapshot(api.catalog, (c) => c.getCatalog());
  const [px, py, pz] = position;
  return useMemo(
    () => api.geometry.worldAABB([px, py, pz], kindId),
    [api.geometry, px, py, pz, kindId, catalogSnapshot],
  );
}
