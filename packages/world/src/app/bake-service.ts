/**
 * Default `BakeService` implementation. Loads each kind's GLTF via the
 * injected loader and runs the existing `getKindBoundingDimensions`
 * primitive. The same code path serves both the live "Recompute from
 * GLTF" button and the headless bake runner — there is only ONE
 * measurement implementation.
 */

// Type-only `THREE` import: the BakeService never instantiates THREE
// objects itself; the injected `loadGltf` does. Keeps the Application
// Layer free of runtime three.js dependencies per CLAUDE.md DIP.
import type * as THREE from 'three';
// DIP exception: the AABB measurement helper lives in the renderer
// because it walks THREE.Object3D scene graphs — an inherently
// THREE-coupled operation. The dependency direction is therefore
// `app/` → `renderer/` for this one pure helper. Acceptable scope;
// alternative was to inject `measureScene` as a fourth dependency
// and add a renderer-side adapter, with no functional gain.
import { getKindBoundingDimensions } from '../renderer/cube-material.ts';
import type {
  BakeService,
  CatalogService,
  KindDimensions,
  KindLocalAABB,
  KindMeasurement,
} from './types.ts';

export interface GltfHandle {
  /** The loaded scene root (THREE.Group/THREE.Object3D). */
  scene: THREE.Object3D;
}

export interface KindAABB {
  /** Local-coord AABB MIN of the GLTF geometry, post-scale. */
  min: { x: number; y: number; z: number };
  /** Local-coord AABB MAX of the GLTF geometry, post-scale. */
  max: { x: number; y: number; z: number };
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

  async function measureKindFull(id: string): Promise<KindMeasurement> {
    const kind = catalog.getKind(id);
    if (!kind) throw new Error(`measureKindFull: unknown kind "${id}"`);
    const { scene } = await loadGltf(kind.gltfPath);
    const m = getKindBoundingDimensions(scene, kind.scale);
    return {
      width: m.width,
      height: m.height,
      depth: m.depth,
      localAABB: { min: m.min, max: m.max },
    };
  }

  async function measureKind(id: string): Promise<KindDimensions> {
    const m = await measureKindFull(id);
    return { width: m.width, height: m.height, depth: m.depth };
  }

  async function measureKindLocalAABB(id: string): Promise<KindLocalAABB> {
    const m = await measureKindFull(id);
    return m.localAABB;
  }

  async function measureAll(): Promise<Map<string, KindMeasurement | null>> {
    const out = new Map<string, KindMeasurement | null>();
    // Sequential rather than Promise.all so a single bad GLTF can't
    // overwhelm the loader. Each measure is cheap once the GLTF cache
    // is warm.
    for (const k of catalog.listKinds()) {
      if (k.category === 'character') continue;
      try {
        out.set(k.id, await measureKindFull(k.id));
      } catch (err) {
        console.warn(`[bake-service] measureKindFull("${k.id}") failed:`, err);
        out.set(k.id, null);
      }
    }
    return out;
  }

  return { measureKind, measureKindLocalAABB, measureKindFull, measureAll };
}
