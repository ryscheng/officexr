/**
 * Default `BakeService` implementation. Loads each kind's GLTF via the
 * injected loader and runs the existing `getKindBoundingDimensions`
 * primitive. The same code path serves both the live "Recompute from
 * GLTF" button and the headless bake runner — there is only ONE
 * measurement implementation.
 */

import * as THREE from 'three';
import { getKindBoundingDimensions } from '../renderer/cube-material.ts';
import type {
  BakeService,
  CatalogService,
  KindDimensions,
} from './types.ts';

export interface GltfHandle {
  /** The loaded scene root (THREE.Group/THREE.Object3D). */
  scene: THREE.Object3D;
}

/** Injected: load a GLTF by URL path and return its scene. The default
 * studio wires drei's `useGLTF.preload` + `useGLTF` here; tests inject
 * a mock that returns a pre-built scene. */
export type GltfLoader = (path: string) => Promise<GltfHandle>;

export function createBakeService(deps: {
  catalog: CatalogService;
  loadGltf: GltfLoader;
}): BakeService {
  const { catalog, loadGltf } = deps;

  async function measureKind(id: string): Promise<KindDimensions> {
    const kind = catalog.getKind(id);
    if (!kind) throw new Error(`measureKind: unknown kind "${id}"`);
    const { scene } = await loadGltf(kind.gltfPath);
    return getKindBoundingDimensions(scene, kind.scale);
  }

  async function measureAll(): Promise<Map<string, KindDimensions | null>> {
    const out = new Map<string, KindDimensions | null>();
    // Sequential rather than Promise.all so a single bad GLTF can't
    // overwhelm the loader. Each measure is cheap once the GLTF cache
    // is warm.
    for (const k of catalog.listKinds()) {
      if (k.category === 'character') continue;
      try {
        out.set(k.id, await measureKind(k.id));
      } catch (err) {
        console.warn(`[bake-service] measureKind("${k.id}") failed:`, err);
        out.set(k.id, null);
      }
    }
    return out;
  }

  return { measureKind, measureAll };
}
