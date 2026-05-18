/**
 * Pin the canonical geometry convention with explicit, unambiguous
 * cases for the two reference kinds the user named:
 *   - colored_block_blue (2 × 2 × 2 m, fully-centered GLTF origin)
 *   - prototype_cube_prototype_large_a (4 × 4 × 4 m, X/Z-centered, Y-bottom)
 *
 * Conventions enforced:
 *   - Voxel position * voxelSize = lower-left-bottom corner of the
 *     world AABB. No matter where the GLTF's local origin sits, the
 *     world AABB anchors at the same point.
 *   - `meshOrigin` translates the mesh by `-localMin` on each axis
 *     so the local AABB lower-left lands at world position*vs.
 */
import { describe, it, expect } from 'vitest';
import { createInstanceGeometry } from '../geometry-service.ts';
import type { CatalogService } from '../types.ts';
import type {
  WorldObjectKind,
  WorldObjectKindCatalogV1,
} from '../../scenes/world-object-kinds-schema.ts';

const VS = 0.5;

function makeKind(
  id: string,
  dims: { width: number; height: number; depth: number } | undefined,
  localAABB?: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  },
): WorldObjectKind {
  return {
    id,
    label: id,
    gltfPath: '/test.glb',
    swatch: '#000',
    walkable: false,
    scale: 1,
    tint: null,
    opacity: 1,
    roughness: null,
    metalness: null,
    emissive: null,
    emissiveIntensity: 0,
    category: 'block',
    tilingAxes: { x: true, y: true, z: true },
    gravity: false,
    isLayoutObject: false,
    optimization: 'none',
    dimensions: dims,
    localAABB,
  };
}

function makeCatalog(kinds: WorldObjectKind[]): CatalogService {
  const cat: WorldObjectKindCatalogV1 = {
    schemaVersion: 1,
    updatedAt: 0,
    kinds,
  };
  return {
    getCatalog: () => cat,
    getKind: (id) => cat.kinds.find((k) => k.id === id),
    listKinds: () => cat.kinds,
    replaceCatalog: () => {},
    patchKind: () => cat,
    subscribe: () => () => {},
    ready: async () => undefined,
  };
}

describe('InstanceGeometry — canonical anchor-lower-left convention', () => {
  const blue = makeKind(
    'colored_block_blue',
    { width: 2, height: 2, depth: 2 },
    // Real KayKit BlockBits GLTF: fully-centered on origin.
    { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } },
  );
  const largeA = makeKind(
    'prototype_cube_prototype_large_a',
    { width: 4, height: 4, depth: 4 },
    // Real KayKit Prototype GLTF: X/Z-centered, Y-bottom.
    { min: { x: -2, y: 0, z: -2 }, max: { x: 2, y: 4, z: 2 } },
  );

  const geom = createInstanceGeometry({
    catalog: makeCatalog([
      blue,
      largeA,
      makeKind('unbaked', undefined, undefined),
    ]),
    voxelSize: VS,
  });

  it('Blue cube at voxel (0,0,0) → world AABB (0,0,0)→(2,2,2)', () => {
    const aabb = geom.worldAABB([0, 0, 0], 'colored_block_blue');
    expect(aabb.min).toEqual([0, 0, 0]);
    expect(aabb.max).toEqual([2, 2, 2]);
  });

  it('Blue mesh origin translates fully-centered GLTF to anchor at world (0,0,0)', () => {
    // Local AABB min = (-1, -1, -1). To put it at world (0, 0, 0):
    // meshRoot = (0 - (-1), 0 - (-1), 0 - (-1)) = (1, 1, 1)
    expect(geom.meshOrigin([0, 0, 0], 'colored_block_blue')).toEqual([1, 1, 1]);
  });

  it('Blue cube at voxel (4,0,0) sits flush against (0,0,0) on x=2', () => {
    const a = geom.worldAABB([0, 0, 0], 'colored_block_blue');
    const b = geom.worldAABB([4, 0, 0], 'colored_block_blue');
    expect(a.max[0]).toBe(2);
    expect(b.min[0]).toBe(2);
    expect(b.max[0]).toBe(4);
  });

  it('Cube Prototype Large A at voxel (0,0,0) → world AABB (0,0,0)→(4,4,4)', () => {
    const aabb = geom.worldAABB([0, 0, 0], 'prototype_cube_prototype_large_a');
    expect(aabb.min).toEqual([0, 0, 0]);
    expect(aabb.max).toEqual([4, 4, 4]);
  });

  it('Large A mesh origin translates X/Z-centered + Y-bottom GLTF', () => {
    // Local AABB min = (-2, 0, -2). To put it at world (0, 0, 0):
    // meshRoot = (0 - (-2), 0 - 0, 0 - (-2)) = (2, 0, 2)
    expect(geom.meshOrigin([0, 0, 0], 'prototype_cube_prototype_large_a')).toEqual(
      [2, 0, 2],
    );
  });

  it('Unbaked kind falls back to 1-voxel-cube AABB at the anchor', () => {
    // Fallback localAABB = (-vs/2, 0, -vs/2) → (+vs/2, vs, +vs/2).
    // Anchored at voxel (0,0,0): world AABB (0, 0, 0) → (0.5, 0.5, 0.5).
    const aabb = geom.worldAABB([0, 0, 0], 'unbaked');
    expect(aabb.min).toEqual([0, 0, 0]);
    expect(aabb.max).toEqual([0.5, 0.5, 0.5]);
  });

  it('voxelFootprint integerises the world AABB onto the voxel grid', () => {
    // Blue cube at voxel (0,0,0): world AABB (0,0,0)→(2,2,2) → voxels (0..4) on each axis.
    const fp = geom.voxelFootprint([0, 0, 0], 'colored_block_blue');
    expect(fp.min).toEqual([0, 0, 0]);
    expect(fp.max).toEqual([4, 4, 4]);
  });

  it('tileStep equals round(dims/vs) per axis with min 1', () => {
    expect(geom.tileStep('colored_block_blue')).toEqual([4, 4, 4]);
    expect(geom.tileStep('prototype_cube_prototype_large_a')).toEqual([8, 8, 8]);
    expect(geom.tileStep('unbaked')).toEqual([1, 1, 1]);
  });

  it('Wireframe AABB = visible mesh AABB (alignment guarantee)', () => {
    // For Blue (fully-centered GLTF), the mesh's WORLD AABB after
    // placement at meshOrigin equals worldAABB. This is the property
    // the user needs: wireframe wraps the visible cube exactly.
    const aabb = geom.worldAABB([0, 0, 0], 'colored_block_blue');
    const origin = geom.meshOrigin([0, 0, 0], 'colored_block_blue');
    // Mesh world extent = meshOrigin + local AABB (min/max).
    const localMin = blue.localAABB!.min;
    const localMax = blue.localAABB!.max;
    const visibleMin = [
      origin[0] + localMin.x,
      origin[1] + localMin.y,
      origin[2] + localMin.z,
    ];
    const visibleMax = [
      origin[0] + localMax.x,
      origin[1] + localMax.y,
      origin[2] + localMax.z,
    ];
    expect(visibleMin).toEqual([...aabb.min]);
    expect(visibleMax).toEqual([...aabb.max]);
  });

  it('Wireframe AABB = visible mesh AABB for Cube Prototype Large A', () => {
    const aabb = geom.worldAABB([0, 0, 0], 'prototype_cube_prototype_large_a');
    const origin = geom.meshOrigin([0, 0, 0], 'prototype_cube_prototype_large_a');
    const lmin = largeA.localAABB!.min;
    const lmax = largeA.localAABB!.max;
    expect([
      origin[0] + lmin.x,
      origin[1] + lmin.y,
      origin[2] + lmin.z,
    ]).toEqual([...aabb.min]);
    expect([
      origin[0] + lmax.x,
      origin[1] + lmax.y,
      origin[2] + lmax.z,
    ]).toEqual([...aabb.max]);
  });

  it('worldAABBOfInstance is sugar over worldAABB', () => {
    const direct = geom.worldAABB([2, 0, 6], 'colored_block_blue');
    const sugar = geom.worldAABBOfInstance({
      id: 'i',
      sourceCommandId: 'c',
      kindId: 'colored_block_blue',
      position: [2, 0, 6],
    });
    expect(sugar).toEqual(direct);
  });
});

describe('InstanceGeometry — constructor validation', () => {
  it('throws when voxelSize <= 0', () => {
    const catalog = makeCatalog([]);
    expect(() => createInstanceGeometry({ catalog, voxelSize: 0 })).toThrow();
    expect(() => createInstanceGeometry({ catalog, voxelSize: -1 })).toThrow();
  });
});
