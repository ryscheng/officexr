import {
  validateCubeKindCatalog,
  type CubeKindCatalogV1,
} from './cube-kinds-schema.ts';

/**
 * Single-document storage adapter for the cube-kind catalog. Talks
 * to the Vite middleware at `/api/cube-kinds` (mounted by
 * `vite-plugin-storage.ts`):
 *
 *   GET  /api/cube-kinds → CubeKindCatalogV1 | 404
 *   PUT  /api/cube-kinds → 204 (body = CubeKindCatalogV1)
 *
 * No `list` / `delete` — there is exactly one catalog file. The
 * Object editor uses this from the studio to round-trip a user's
 * material-override edits to disk; the renderer's in-memory store
 * (`cube-catalog.ts`) holds the live view.
 */
export interface CatalogStorage {
  load(): Promise<CubeKindCatalogV1 | null>;
  save(catalog: CubeKindCatalogV1): Promise<void>;
}

export class FilesystemCatalogStorage implements CatalogStorage {
  private base: string;

  constructor(opts: { basePath?: string } = {}) {
    this.base = (opts.basePath ?? '/api/cube-kinds').replace(/\/$/, '');
  }

  async load(): Promise<CubeKindCatalogV1 | null> {
    const r = await fetch(this.base, { method: 'GET' });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`catalog-storage load: ${r.status}`);
    const raw = (await r.json()) as unknown;
    return validateCubeKindCatalog(raw);
  }

  async save(catalog: CubeKindCatalogV1): Promise<void> {
    const r = await fetch(this.base, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(catalog),
    });
    if (!r.ok) throw new Error(`catalog-storage save: ${r.status}`);
  }
}
