/**
 * @deprecated Renamed to object-kind-catalog.ts. Import from
 * `./object-kind-catalog.ts` or through `@officexr/world/scenes` instead.
 *
 * This shim exists for backward compatibility during the rename (task-00).
 */
export {
  bootstrapCatalog,
  getCatalog,
  getKind,
  listKinds,
  patchKind,
  replaceCatalog,
  resetCatalogToDefault,
  subscribeCatalog,
  useObjectKindCatalog,
  useCubeCatalog,
  __resetBootstrapForTests,
} from './object-kind-catalog.ts';
