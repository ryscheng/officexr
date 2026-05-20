import { LocalStorageLayoutStorage } from './localstorage-layout-storage.ts';
import { createMemoryWebStorage } from './in-memory-web-storage.ts';
import type { LayoutDocument } from './layout-document.ts';
import type {
  LayoutStorage,
  LayoutSummary,
} from './filesystem-layout-storage.ts';

export interface LayoutSeedEntry {
  name: string;
  doc: LayoutDocument;
}

/**
 * Hermetic, in-process `LayoutStorage` for tests. Composes
 * `LocalStorageLayoutStorage` over a `Map`-backed `Storage` shim so its
 * semantics — name validation, `deserializeLayout` round-trip, index
 * bookkeeping — match the real localStorage path by construction (LSP).
 * Adds a `seed` convenience for pre-population. (Baked GLBs are
 * filesystem-only and out of scope here, same as the localStorage impl.)
 */
export class InMemoryLayoutStorage implements LayoutStorage {
  private delegate: LocalStorageLayoutStorage;

  constructor(opts: { seed?: readonly LayoutSeedEntry[] } = {}) {
    this.delegate = new LocalStorageLayoutStorage({
      storage: createMemoryWebStorage(),
    });
    for (const entry of opts.seed ?? []) {
      void this.delegate.save(entry.name, entry.doc).catch(() => {});
    }
  }

  list(): Promise<LayoutSummary[]> {
    return this.delegate.list();
  }

  load(name: string): Promise<LayoutDocument | null> {
    return this.delegate.load(name);
  }

  save(name: string, layout: LayoutDocument): Promise<void> {
    return this.delegate.save(name, layout);
  }

  delete(name: string): Promise<void> {
    return this.delegate.delete(name);
  }
}
