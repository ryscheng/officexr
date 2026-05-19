export type {
  ApplicationApi,
  BakeService,
  CameraPose,
  CatalogService,
  InstanceGeometryService,
  KindDimensions,
  KindLocalAABB,
  KindMeasurement,
  ProgrammaticScene,
  RoomService,
  SceneService,
  Vec3,
  VoxelFootprint,
  WorldAABB,
} from './types.ts';

export { createCatalogService } from './catalog-service.ts';
export type { CreateCatalogServiceOptions } from './catalog-service.ts';

export { createInstanceGeometry } from './geometry-service.ts';

export { createRoomService } from './room-service.ts';

export { createBakeService } from './bake-service.ts';
export type { GltfHandle, GltfLoader } from './bake-service.ts';

export { createSceneService } from './scene-service.ts';

export { bakeLayout } from './layout-bake-service.ts';
export type {
  KindLookup,
  BakeOptions,
  BakeResultBytes,
} from './layout-bake-service.ts';

export {
  scheduleBake,
  getBakePromise,
  awaitFresh,
  getVersion,
  subscribe,
  getBakeState,
  listAllBakes,
  _resetRegistry,
} from './bake-registry.ts';
export type {
  BakeResult,
  BakeDeps,
  BakeState,
} from './bake-registry.ts';

export { createBrowserBakeDeps } from './layout-bake-service-browser.ts';

export {
  BAKE_OPTIMIZERS,
  DEFAULT_OPTIMIZER_ID,
  defaultOptimizer,
  noneOptimizer,
  simplifyLightOptimizer,
  simplifyAggressiveOptimizer,
  resolveOptimizer,
} from './bake-optimizers.ts';
export type { BakeOptimizer } from './bake-optimizers.ts';

export { createDefaultApi } from './create-default-api.ts';
export type { CreateDefaultApiOptions } from './create-default-api.ts';
