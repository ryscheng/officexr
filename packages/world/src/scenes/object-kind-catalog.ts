/**
 * Legacy module-globals for the world-object-kind catalog have been
 * removed. All callers consume the catalog through the application
 * layer:
 *
 *   - In non-React code: receive a `CatalogService` via constructor
 *     injection (see `@officexr/world/app`).
 *   - In React: read via `useApplication()` / `useCatalog()` /
 *     `useKind()` / `useCatalogReady()` from `@officexr/world/react`.
 *
 * The default `CatalogService` implementation lives in
 * `packages/world/src/app/catalog-service.ts`. This file is preserved
 * as a stub so that any straggling import paths fail loudly with a
 * grep-friendly error rather than mysteriously continuing to work
 * against a stale module-global.
 */

// Re-export the validated catalog type for back-compat — it's a
// schema-shape, not a singleton.
export type {
  WorldObjectKindCatalogV1,
  WorldObjectKind,
} from './world-object-kinds-schema.ts';
