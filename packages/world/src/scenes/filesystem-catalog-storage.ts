import {
  validateWorldObjectKindCatalog,
  type WorldObjectKindCatalogV1,
} from './world-object-kinds-schema.ts';

/**
 * Single-document storage adapter for the world-object-kind catalog. Talks
 * to the Vite middleware at `/api/world-object-kinds` (mounted by
 * `vite-plugin-storage.ts`):
 *
 *   GET  /api/world-object-kinds → WorldObjectKindCatalogV1 | 404
 *   PUT  /api/world-object-kinds → 204 (body = WorldObjectKindCatalogV1)
 *
 * No `list` / `delete` — there is exactly one catalog file. The
 * Object editor uses this from the studio to round-trip a user's
 * material-override edits to disk; the renderer's in-memory store
 * (`object-kind-catalog.ts`) holds the live view.
 */
export interface CatalogStorage {
  load(): Promise<WorldObjectKindCatalogV1 | null>;
  save(catalog: WorldObjectKindCatalogV1): Promise<void>;
}

export class FilesystemCatalogStorage implements CatalogStorage {
  private base: string;

  constructor(opts: { basePath?: string } = {}) {
    this.base = (opts.basePath ?? '/api/world-object-kinds').replace(/\/$/, '');
  }

  async load(): Promise<WorldObjectKindCatalogV1 | null> {
    const r = await fetch(this.base, { method: 'GET' });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`catalog-storage load: ${r.status}`);
    const raw = (await r.json()) as unknown;
    return validateWorldObjectKindCatalog(raw);
  }

  async save(catalog: WorldObjectKindCatalogV1): Promise<void> {
    const r = await fetch(this.base, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(catalog),
    });
    if (!r.ok) throw new Error(`catalog-storage save: ${r.status}`);
  }
}
