import { Group } from 'three';
import { createDefaultApi } from '@officexr/world/app';
import type { ApplicationApi } from '@officexr/world/app';
import type { GltfLoader } from '@officexr/world/app';

export interface CreateTestApiOptions {
  /** GLTF loader the BakeService uses. Defaults to a no-op that
   *  resolves to an empty group, so a bake scheduled during a test
   *  (e.g. the Layout hook's afterSave) is harmless rather than
   *  throwing. Pass a real loader only if a test asserts on bake
   *  output. */
  loadGltf?: GltfLoader;
}

/**
 * Composes a hermetic `ApplicationApi` for tests.
 *
 * Delegates to the production `createDefaultApi` with `apiPath: ''`,
 * which disables the live `/api/world-object-kinds` fetch and uses the
 * bundled default catalog instead. This is the single DI seam the
 * roadmap leans on: editors mounted under a provider built from this
 * api never touch the network or the dev-server filesystem.
 */
export function createTestApi(opts: CreateTestApiOptions = {}): ApplicationApi {
  return createDefaultApi({
    apiPath: '',
    loadGltf: opts.loadGltf ?? (async () => ({ scene: new Group() })),
  });
}
