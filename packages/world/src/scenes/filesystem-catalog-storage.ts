import { FilesystemSingleDocumentStorage } from './filesystem-single-document-storage.ts';
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

export class FilesystemCatalogStorage
  extends FilesystemSingleDocumentStorage<WorldObjectKindCatalogV1>
  implements CatalogStorage
{
  constructor(opts: { basePath?: string } = {}) {
    super(
      opts.basePath ?? '/api/world-object-kinds',
      'catalog-storage',
      validateWorldObjectKindCatalog,
    );
  }
}
