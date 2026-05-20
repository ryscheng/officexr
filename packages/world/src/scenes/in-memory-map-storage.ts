import { LocalStorageMapStorage } from './localstorage-map-storage.ts';
import { createMemoryWebStorage } from './in-memory-web-storage.ts';
import type { MapDocumentV1 } from './map-document.ts';
import type { MapStorage, MapSummary } from './filesystem-map-storage.ts';

export interface MapSeedEntry {
  name: string;
  doc: MapDocumentV1;
}

/**
 * Hermetic, in-process `MapStorage` for tests and static-host previews.
 *
 * Composes `LocalStorageMapStorage` over a `Map`-backed `Storage` shim,
 * so its `list / load / save / delete` semantics — name validation,
 * `deserializeMap` round-trip, index bookkeeping — are identical to the
 * real localStorage path by construction (LSP). The only addition is a
 * convenience `seed` so a test can pre-populate documents without
 * hand-rolling JSON.
 */
export class InMemoryMapStorage implements MapStorage {
  private delegate: LocalStorageMapStorage;

  constructor(opts: { seed?: readonly MapSeedEntry[] } = {}) {
    this.delegate = new LocalStorageMapStorage({
      storage: createMemoryWebStorage(),
    });
    // `save` writes synchronously (no internal await), so the seed is
    // present by the time the constructor returns. `.catch` guards
    // against an invalid seed name surfacing as an unhandled rejection.
    for (const entry of opts.seed ?? []) {
      void this.delegate.save(entry.name, entry.doc).catch(() => {});
    }
  }

  list(): Promise<MapSummary[]> {
    return this.delegate.list();
  }

  load(name: string): Promise<MapDocumentV1 | null> {
    return this.delegate.load(name);
  }

  save(name: string, map: MapDocumentV1): Promise<void> {
    return this.delegate.save(name, map);
  }

  delete(name: string): Promise<void> {
    return this.delegate.delete(name);
  }
}
