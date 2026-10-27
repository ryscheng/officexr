/**
 * @deprecated Renamed to world-object-kinds-schema.ts. Import from
 * `./world-object-kinds-schema.ts` or through `@officexr/world/scenes` instead.
 *
 * This shim exists for backward compatibility during the rename (task-00).
 */
export {
  type CubeKindCategory,
  CUBE_KIND_CATEGORIES,
  type WorldObjectKind,
  type WorldObjectKindCatalogV1,
  WORLD_OBJECT_KIND_DEFAULTS,
  validateWorldObjectKindCatalog,
  normalizeKind,
  // Back-compat aliases
  type CubeKindEntry,
  type CubeKindCatalogV1,
  CUBE_KIND_DEFAULTS,
  validateCubeKindCatalog,
} from './world-object-kinds-schema.ts';
