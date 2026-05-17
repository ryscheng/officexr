/**
 * Default implementation of `CatalogService`. Lifts the prior
 * `object-kind-catalog.ts` module-globals into an instance whose
 * dependencies (fetcher, default catalog JSON) are injected.
 *
 * SOLID note (DIP): callers don't import this file directly — they
 * receive a `CatalogService` through the DI container (the React
 * context for the UI layer; the `ApplicationApi` for the headless
 * layer). Tests construct a mock by implementing the `CatalogService`
 * interface, not by patching this file's internals.
 */

import {
  validateWorldObjectKindCatalog,
  type WorldObjectKindCatalogV1,
  type WorldObjectKind,
} from '../scenes/world-object-kinds-schema.ts';
import type { CatalogService } from './types.ts';

export interface CreateCatalogServiceOptions {
  /** The JSON-validated catalog the service is initialised with. The
   * bundled default lives in `packages/world/world-object-kinds.default.json`
   * — the caller imports + validates and hands it over. Keeps this
   * module free of file-system imports. */
  defaultCatalog: WorldObjectKindCatalogV1;
  /** Path the service fetches on first `ready()` call. Defaults to
   * `/api/world-object-kinds`. Pass an empty string to disable the
   * fetch (the service then stays on `defaultCatalog`). */
  apiPath?: string;
  /** Injected fetch implementation. Defaults to `globalThis.fetch`. Tests
   * override this with a mock that returns a canned payload. */
  fetcher?: (url: string) => Promise<Response>;
}

export function createCatalogService(
  opts: CreateCatalogServiceOptions,
): CatalogService {
  const apiPath = (opts.apiPath ?? '/api/world-object-kinds').replace(/\/$/, '');
  const fetcher = opts.fetcher ?? globalThis.fetch?.bind(globalThis);

  let current: WorldObjectKindCatalogV1 = opts.defaultCatalog;
  const listeners = new Set<() => void>();
  let readyPromise: Promise<void> | null = null;

  function emit() {
    for (const l of listeners) l();
  }

  function bootstrap(): Promise<void> {
    if (readyPromise) return readyPromise;
    if (!apiPath || !fetcher) {
      // Fetch disabled — already ready on the bundled default.
      readyPromise = Promise.resolve();
      return readyPromise;
    }
    readyPromise = (async () => {
      try {
        const r = await fetcher(apiPath);
        if (!r.ok) throw new Error(`bootstrap status ${r.status}`);
        const json = (await r.json()) as unknown;
        const validated = validateWorldObjectKindCatalog(json);
        current = validated;
        emit();
      } catch (err) {
        // Fall back to the bundled default with a warning. The renderer
        // keeps rendering, just without the user's authored edits.
        console.warn('[catalog-service] bootstrap fallback to default:', err);
      }
    })();
    return readyPromise;
  }

  // Kick off bootstrap eagerly so `getKind` becomes correct as soon as
  // the network responds, even if no one explicitly awaits `ready()`.
  // Errors are caught above; this is fire-and-forget.
  void bootstrap();

  return {
    getCatalog: () => current,
    getKind: (id) => current.kinds.find((k) => k.id === id),
    listKinds: () => current.kinds,
    replaceCatalog(next) {
      current = next;
      emit();
    },
    patchKind(id, partial) {
      const next: WorldObjectKindCatalogV1 = {
        ...current,
        updatedAt: Date.now(),
        kinds: current.kinds.map((k) =>
          k.id === id ? ({ ...k, ...partial } as WorldObjectKind) : k,
        ),
      };
      current = next;
      emit();
      return next;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    ready: () => bootstrap(),
  };
}
