import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { createBakeService } from '../bake-service.ts';
import { createCatalogService } from '../catalog-service.ts';
import type {
  WorldObjectKind,
  WorldObjectKindCatalogV1,
} from '../../scenes/world-object-kinds-schema.ts';

function makeKind(
  id: string,
  category: WorldObjectKind['category'] = 'block',
  scale = 1,
): WorldObjectKind {
  return {
    id,
    label: id,
    gltfPath: `/${id}.glb`,
    swatch: '#fff',
    walkable: false,
    scale,
    tint: null,
    opacity: 1,
    roughness: null,
    metalness: null,
    emissive: null,
    emissiveIntensity: 0,
    category,
    tilingAxes: { x: true, y: true, z: true },
    gravity: false,
    isLayoutObject: false,
    optimization: 'none',
  };
}

/** Build a fake GLTF scene with a single Mesh whose geometry has the
 * given AABB. `getKindBoundingDimensions` reads the geometry's bounding
 * box, multiplies by `scale`, and returns metres. */
function fakeScene(min: [number, number, number], max: [number, number, number]): THREE.Object3D {
  const geom = new THREE.BoxGeometry(
    max[0] - min[0],
    max[1] - min[1],
    max[2] - min[2],
  );
  // BoxGeometry centres itself on the origin; shift so its AABB matches
  // (min, max) exactly.
  geom.translate(
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  );
  geom.computeBoundingBox();
  const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial());
  const root = new THREE.Group();
  root.add(mesh);
  return root;
}

describe('BakeService', () => {
  const catalog = createCatalogService({
    defaultCatalog: {
      schemaVersion: 1,
      updatedAt: 0,
      kinds: [
        makeKind('blue'),
        makeKind('largeA'),
        makeKind('aCharacter', 'character'),
      ],
    } as WorldObjectKindCatalogV1,
    apiPath: '',
  });

  const sceneByPath: Record<string, THREE.Object3D> = {
    '/blue.glb': fakeScene([-1, 0, -1], [1, 2, 1]),
    '/largeA.glb': fakeScene([-2, 0, -2], [2, 4, 2]),
    '/aCharacter.glb': fakeScene([-0.5, 0, -0.5], [0.5, 1.8, 0.5]),
  };

  const loadGltf = vi.fn(async (path: string) => {
    const scene = sceneByPath[path];
    if (!scene) throw new Error(`unknown path ${path}`);
    return { scene };
  });

  const bake = createBakeService({ catalog, loadGltf });

  it('measureKind returns post-scale GLTF AABB dims', async () => {
    expect(await bake.measureKind('blue')).toEqual({
      width: 2,
      height: 2,
      depth: 2,
    });
    expect(await bake.measureKind('largeA')).toEqual({
      width: 4,
      height: 4,
      depth: 4,
    });
  });

  it('measureKindLocalAABB exposes the GLTF local-coord AABB', async () => {
    expect(await bake.measureKindLocalAABB('blue')).toEqual({
      min: { x: -1, y: 0, z: -1 },
      max: { x: 1, y: 2, z: 1 },
    });
    expect(await bake.measureKindLocalAABB('largeA')).toEqual({
      min: { x: -2, y: 0, z: -2 },
      max: { x: 2, y: 4, z: 2 },
    });
  });

  it('measureKindFull bundles extents + localAABB in a single load', async () => {
    const full = await bake.measureKindFull('blue');
    expect(full.width).toBe(2);
    expect(full.height).toBe(2);
    expect(full.depth).toBe(2);
    expect(full.localAABB).toEqual({
      min: { x: -1, y: 0, z: -1 },
      max: { x: 1, y: 2, z: 1 },
    });
  });

  it('measureAll measures every non-character kind', async () => {
    const out = await bake.measureAll();
    expect(out.has('blue')).toBe(true);
    expect(out.has('largeA')).toBe(true);
    expect(out.has('aCharacter')).toBe(false); // characters are skipped
    const blue = out.get('blue');
    expect(blue?.localAABB.min).toEqual({ x: -1, y: 0, z: -1 });
  });

  it('measureKind throws for unknown kind id', async () => {
    await expect(bake.measureKind('does-not-exist')).rejects.toThrow();
  });
});
