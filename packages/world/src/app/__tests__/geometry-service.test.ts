/**
 * Pin the canonical geometry convention with explicit, unambiguous
 * cases for two reference kinds the user named:
 *   - colored_block_blue (2 × 2 × 2 m)
 *   - prototype_cube_prototype_large_a (4 × 4 × 4 m)
 *
 * Convention enforced by these tests:
 *   - X/Z: AABB is centered on position * voxelSize.
 *   - Y: AABB bottom sits at position * voxelSize (floor convention).
 *   - No `+ voxelSize / 2` offset. (Regression of the offset would
 *     flip every test in this file.)
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
    optimization: 'none',
    dimensions: dims,
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

describe('InstanceGeometry — canonical convention', () => {
  const catalog = makeCatalog([
    makeKind('colored_block_blue', { width: 2, height: 2, depth: 2 }),
    makeKind('prototype_cube_prototype_large_a', {
      width: 4,
      height: 4,
      depth: 4,
    }),
    makeKind('unbaked', undefined),
  ]);
  const geom = createInstanceGeometry({ catalog, voxelSize: VS });

  it('Blue cube at voxel (0,0,0) → AABB (-1, 0, -1) to (1, 2, 1)', () => {
    const aabb = geom.worldAABB([0, 0, 0], 'colored_block_blue');
    expect(aabb.min).toEqual([-1, 0, -1]);
    expect(aabb.max).toEqual([1, 2, 1]);
  });

  it('Blue cube at voxel (4,0,0) sits flush against the one at (0,0,0) on x=1', () => {
    const a = geom.worldAABB([0, 0, 0], 'colored_block_blue');
    const b = geom.worldAABB([4, 0, 0], 'colored_block_blue');
    expect(b.min[0]).toBe(1); // touches A's max.x
    expect(b.max[0]).toBe(3);
    expect(a.max[0]).toBe(b.min[0]); // adjacent, no gap, no overlap
  });

  it('Cube Prototype Large A at voxel (0,0,0) → AABB (-2, 0, -2) to (2, 4, 2)', () => {
    const aabb = geom.worldAABB([0, 0, 0], 'prototype_cube_prototype_large_a');
    expect(aabb.min).toEqual([-2, 0, -2]);
    expect(aabb.max).toEqual([2, 4, 2]);
  });

  it('Unbaked kind falls back to a 1-voxel-cube AABB centered on position', () => {
    // Voxel (0,0,0) on a 0.5 m grid → world AABB (-0.25, 0, -0.25) → (0.25, 0.5, 0.25).
    const aabb = geom.worldAABB([0, 0, 0], 'unbaked');
    expect(aabb.min).toEqual([-0.25, 0, -0.25]);
    expect(aabb.max).toEqual([0.25, 0.5, 0.25]);
  });

  it('meshOrigin returns (cx, AABB.min.y, cz) for bottom-center GLTFs', () => {
    expect(geom.meshOrigin([0, 0, 0], 'colored_block_blue')).toEqual([0, 0, 0]);
    expect(geom.meshOrigin([4, 0, 0], 'colored_block_blue')).toEqual([2, 0, 0]);
    expect(geom.meshOrigin([0, 2, 0], 'colored_block_blue')).toEqual([0, 1, 0]);
  });

  it('voxelFootprint integerises the AABB on the voxel grid', () => {
    // Blue cube at voxel (0,0,0): world AABB (-1, 0, -1)..(1, 2, 1).
    // On a 0.5 m grid that's voxel cells from (-2, 0, -2) to (2, 4, 2) exclusive.
    const fp = geom.voxelFootprint([0, 0, 0], 'colored_block_blue');
    expect(fp.min).toEqual([-2, 0, -2]);
    expect(fp.max).toEqual([2, 4, 2]);
  });

  it('tileStep equals round(dims/vs) per axis with min 1', () => {
    expect(geom.tileStep('colored_block_blue')).toEqual([4, 4, 4]);
    expect(geom.tileStep('prototype_cube_prototype_large_a')).toEqual([8, 8, 8]);
    expect(geom.tileStep('unbaked')).toEqual([1, 1, 1]);
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
