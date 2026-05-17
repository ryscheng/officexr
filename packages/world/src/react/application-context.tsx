/**
 * React inversion-of-control for the Application Layer.
 *
 * Components consume `ApplicationApi` through this context — never via
 * module-level singletons. Tests + headless harnesses provide their own
 * `ApplicationApi` (real or mocked) at the provider boundary.
 *
 * Derived hooks (`useCatalog`, `useCatalogReady`, `useKind`,
 * `useInstanceAABB`, …) subscribe to the catalog's listeners so React
 * components re-render exactly when the underlying service emits.
 */
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from 'react';
import type {
  ApplicationApi,
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
// Derived hooks
// ---------------------------------------------------------------------------

/** Subscribe to catalog changes and return the live list of kinds. */
export function useCatalog(): readonly WorldObjectKind[] {
  const api = useApplication();
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => api.catalog.subscribe(force), [api.catalog]);
  return api.catalog.listKinds();
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
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => api.catalog.subscribe(force), [api.catalog]);
  if (!id) return undefined;
  return api.catalog.getKind(id);
}

/**
 * Compute an instance's world AABB. Subscribes to the catalog so the
 * AABB recomputes if the kind's dimensions are edited live in the
 * Object editor.
 */
export function useInstanceAABB(position: Vec3, kindId: string): WorldAABB {
  const api = useApplication();
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => api.catalog.subscribe(force), [api.catalog]);
  return useMemo(
    () => api.geometry.worldAABB(position, kindId),
    // Subscribing forces a recompute; deps cover the inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api.geometry, position[0], position[1], position[2], kindId],
  );
}
