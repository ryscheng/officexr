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
    isReady: () => true,
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

describe('InstanceGeometry — yaw', () => {
  // A 4×1-voxel wall whose GLTF origin sits at its local min corner, so
  // meshTransform has a non-zero pivot offset to correct for.
  const wall = makeKind(
    'wall',
    { width: 2, height: 1.5, depth: 0.5 },
    { min: { x: 0, y: 0, z: 0 }, max: { x: 2, y: 1.5, z: 0.5 } },
  );
  const geom = createInstanceGeometry({ catalog: makeCatalog([wall]), voxelSize: VS });
  const r = Math.SQRT1_2 * 1.25;

  it.each([
    { yaw: 0, min: [0, 0, 0], max: [2, 1.5, 0.5], fpMin: [0, 0, 0], fpMax: [4, 3, 1] },
    { yaw: 90, min: [0.75, 0, -0.75], max: [1.25, 1.5, 1.25], fpMin: [1, 0, -2], fpMax: [3, 3, 3] },
    { yaw: 180, min: [0, 0, 0], max: [2, 1.5, 0.5], fpMin: [0, 0, 0], fpMax: [4, 3, 1] },
    { yaw: 270, min: [0.75, 0, -0.75], max: [1.25, 1.5, 1.25], fpMin: [1, 0, -2], fpMax: [3, 3, 3] },
    { yaw: 45, min: [1 - r, 0, 0.25 - r], max: [1 + r, 1.5, 0.25 + r], fpMin: [0, 0, -2], fpMax: [4, 3, 3] },
  ])('yaw $yaw rotates the footprint about its centre', ({ yaw, min, max, fpMin, fpMax }) => {
    const aabb = geom.worldAABB([0, 0, 0], 'wall', yaw);
    aabb.min.forEach((v, i) => expect(v).toBeCloseTo(min[i], 9));
    aabb.max.forEach((v, i) => expect(v).toBeCloseTo(max[i], 9));
    expect(geom.voxelFootprint([0, 0, 0], 'wall', yaw)).toEqual({ min: fpMin, max: fpMax });
  });

  it('yaw 0 and multiples of 360 match the unrotated results exactly', () => {
    for (const yaw of [0, 360, -360]) {
      expect(geom.worldAABB([3, 1, 5], 'wall', yaw)).toEqual(geom.worldAABB([3, 1, 5], 'wall'));
      expect(geom.meshTransform([3, 1, 5], 'wall', yaw)).toEqual({
        position: geom.meshOrigin([3, 1, 5], 'wall'),
        rotationY: 0,
      });
    }
  });

  it('worldAABBOfInstance passes the instance yaw', () => {
    const inst = { id: 'i', sourceCommandId: 'c', kindId: 'wall', position: [0, 0, 0] as [number, number, number] };
    expect(geom.worldAABBOfInstance({ ...inst, yawDeg: 90 })).toEqual(geom.worldAABB([0, 0, 0], 'wall', 90));
  });

  it('tileStep follows the rotated AABB size', () => {
    expect(geom.tileStep('wall')).toEqual([4, 3, 1]);
    expect(geom.tileStep('wall', 90)).toEqual([1, 3, 4]);
    expect(geom.tileStep('wall', 45)).toEqual([4, 3, 4]);
  });

  it.each([0, 45, 90, 180, 270, 30])('meshTransform at yaw %i lands the mesh in its AABB', (yaw) => {
    const { position, rotationY } = geom.meshTransform([2, 1, 6], 'wall', yaw);
    expect(rotationY).toBeCloseTo((yaw * Math.PI) / 180, 12);
    // Rotate the local AABB corners the way three.js `rotation.y` does.
    const cos = Math.cos(rotationY);
    const sin = Math.sin(rotationY);
    const xs: number[] = [];
    const zs: number[] = [];
    for (const x of [0, 2]) {
      for (const z of [0, 0.5]) {
        xs.push(position[0] + x * cos + z * sin);
        zs.push(position[2] - x * sin + z * cos);
      }
    }
    const aabb = geom.worldAABB([2, 1, 6], 'wall', yaw);
    expect(Math.min(...xs)).toBeCloseTo(aabb.min[0], 9);
    expect(Math.max(...xs)).toBeCloseTo(aabb.max[0], 9);
    expect(Math.min(...zs)).toBeCloseTo(aabb.min[2], 9);
    expect(Math.max(...zs)).toBeCloseTo(aabb.max[2], 9);
    expect(position[1]).toBe(aabb.min[1]);
  });
});

describe('InstanceGeometry — primitive diagnostic boxes', () => {
  const geom = createInstanceGeometry({ catalog: makeCatalog([]), voxelSize: VS });

  it('pivots meshTransform on the same 2 m box worldAABB uses', () => {
    // The primitive mesh is a 2 m box centred on its root.
    const { position } = geom.meshTransform([0, 0, 0], '__primitive_blue', 90);
    const aabb = geom.worldAABB([0, 0, 0], '__primitive_blue', 90);
    expect(position.map((v, i) => v - (aabb.min[i] + aabb.max[i]) / 2)).toEqual([0, 0, 0]);
  });
});
