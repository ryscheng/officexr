export {
  type SceneStorage,
  type SceneSummary,
  isValidSceneName,
  SCENE_NAME_RE,
} from './storage.ts';
export {
  type SerializedScene,
  type SerializedSceneV1,
  type SerializedSceneV2,
  type SerializedRoomV3,
  type SerializeV2Input,
  type SerializeV1Input,
  type SerializeRoomInput,
  type SerializeMapInput,
  serializeScene,
  serializeSceneV1,
  serializeRoom,
  serializeMap,
  deserializeScene,
  deserializeMap,
  migrateToV2,
  migrateToV3,
} from './serialize.ts';
export {
  type SceneCommand,
  type PlaceObjectCommand,
  type PlaceCubeCommand,
  type ExtrudeCommand,
  type SceneDocument,
  type RoomDocument,
  type RoomGroup,
  type CubeFace,
  CUBE_FACES,
  newPlaceObject,
  newPlaceCube,
  newExtrude,
  emptyDocument,
  emptyRoomDocument,
} from './commands.ts';
export {
  type MapDocumentV1,
  type RoomInstance,
  type SpawnPoint,
  type MapEnvironment,
  type MapSunSettings,
  type MapSkySettings,
  type MapStarsSettings,
  type MapHdriSettings,
  DEFAULT_MAP_ENVIRONMENT,
  emptyMapDocument,
} from './map-document.ts';
export {
  compileScene,
  commandBounds,
} from './compile.ts';
export { compileMap } from './compile-map.ts';
// CUBE_KINDS / getCubeKind / UNKNOWN_KIND_SWATCH / CubeKindDef were
// the back-compat shim for code predating the catalog service.
// Removed in the three-layer architecture refactor; consume the
// catalog via `@officexr/world/app` or `@officexr/world/react`.
export {
  type WorldObjectKind,
  type WorldObjectKindCatalogV1,
  type CubeKindEntry,
  type CubeKindCatalogV1,
  type CubeKindCategory,
  type OptimizationMode,
  CUBE_KIND_CATEGORIES,
  WORLD_OBJECT_KIND_DEFAULTS,
  CUBE_KIND_DEFAULTS,
  validateWorldObjectKindCatalog,
  validateCubeKindCatalog,
  normalizeKind,
} from './world-object-kinds-schema.ts';
// Module-globals for the kind catalog were removed in the three-layer
// architecture refactor. Consume the catalog through the application
// layer (`@officexr/world/app`) and the React context
// (`@officexr/world/react`). See `app/catalog-service.ts`.
export { FilesystemSceneStorage } from './filesystem-storage.ts';
export { LocalStorageSceneStorage } from './localstorage-storage.ts';
export {
  type RoomStorage,
  type RoomSummary,
  FilesystemRoomStorage,
} from './filesystem-room-storage.ts';
export { LocalStorageRoomStorage } from './localstorage-room-storage.ts';
export {
  type MapStorage,
  type MapSummary,
  FilesystemMapStorage,
} from './filesystem-map-storage.ts';
export { LocalStorageMapStorage } from './localstorage-map-storage.ts';
export {
  type CatalogStorage,
  FilesystemCatalogStorage,
} from './filesystem-catalog-storage.ts';
export { thumbnailUrlForKind } from './thumbnails.ts';
