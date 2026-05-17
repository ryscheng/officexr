/**
 * Wires the default `ApplicationApi` for production: catalog backed by
 * the bundled default JSON + a live fetch of `/api/world-object-kinds`,
 * geometry at the project-wide `VOXEL_SIZE`, and so on.
 *
 * Tests construct an `ApplicationApi` directly by composing service
 * implementations (real or mocked), without calling this function.
 */

import defaultCatalogJson from '../../world-object-kinds.default.json' with { type: 'json' };
import { validateWorldObjectKindCatalog } from '../scenes/world-object-kinds-schema.ts';
import { VOXEL_SIZE } from '../renderer/config.ts';
import { createCatalogService } from './catalog-service.ts';
import { createInstanceGeometry } from './geometry-service.ts';
import { createRoomService } from './room-service.ts';
import { createBakeService, type GltfLoader } from './bake-service.ts';
import { createSceneService } from './scene-service.ts';
import type { ApplicationApi } from './types.ts';

export interface CreateDefaultApiOptions {
  voxelSize?: number;
  apiPath?: string;
  fetcher?: (url: string) => Promise<Response>;
  /** GLTF loader the BakeService uses. The UI wires drei's `useGLTF`
   * here; Node-side tooling can wire a different loader (e.g. a JSDom
   * wrapper around three's GLTFLoader). When omitted the BakeService
   * will throw on use — that's intentional, you must opt in to bake
   * functionality by providing a loader. */
  loadGltf?: GltfLoader;
}

export function createDefaultApi(
  opts: CreateDefaultApiOptions = {},
): ApplicationApi {
  const voxelSize = opts.voxelSize ?? VOXEL_SIZE;

  const catalog = createCatalogService({
    defaultCatalog: validateWorldObjectKindCatalog(defaultCatalogJson),
    apiPath: opts.apiPath,
    fetcher: opts.fetcher,
  });
  const geometry = createInstanceGeometry({ catalog, voxelSize });
  const rooms = createRoomService({ geometry });
  const bake = createBakeService({
    catalog,
    loadGltf:
      opts.loadGltf ??
      (() => {
        throw new Error(
          'BakeService: no GltfLoader was provided. Pass `loadGltf` to createDefaultApi() to enable bake functionality.',
        );
      }),
  });
  const scenes = createSceneService();

  return { voxelSize, catalog, geometry, rooms, bake, scenes };
}
