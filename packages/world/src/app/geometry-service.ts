/**
 * Default implementation of `InstanceGeometryService`. Pure math; the only
 * dependency is a `CatalogService` from which it reads `kind.dimensions`.
 */

import type {
  CatalogService,
  InstanceGeometryService,
  Vec3,
  VoxelFootprint,
  WorldAABB,
} from './types.ts';
import type { ObjectInstance } from '@officexr/sdk';

export function createInstanceGeometry(deps: {
  catalog: CatalogService;
  voxelSize: number;
}): InstanceGeometryService {
  const { catalog, voxelSize } = deps;
  if (voxelSize <= 0) {
    throw new Error(`createInstanceGeometry: voxelSize must be > 0, got ${voxelSize}`);
  }

  function dimsFor(kindId: string): {
    width: number;
    height: number;
    depth: number;
  } {
    const kind = catalog.getKind(kindId);
    if (kind?.dimensions) return kind.dimensions;
    // One canonical fallback: a single voxel cell on each axis. This
    // preserves the historic "1 cube per voxel" feel for un-baked kinds
    // without spreading fallback logic across every consumer.
    return { width: voxelSize, height: voxelSize, depth: voxelSize };
  }

  function worldAABB(position: Vec3, kindId: string): WorldAABB {
    const dims = dimsFor(kindId);
    const cx = position[0] * voxelSize;
    const by = position[1] * voxelSize; // floor convention — NO +vs/2
    const cz = position[2] * voxelSize;
    return {
      min: [cx - dims.width / 2, by, cz - dims.depth / 2],
      max: [cx + dims.width / 2, by + dims.height, cz + dims.depth / 2],
    };
  }

  function worldAABBOfInstance(instance: ObjectInstance): WorldAABB {
    return worldAABB(instance.position, instance.kindId);
  }

  function meshOrigin(position: Vec3, kindId: string): Vec3 {
    const aabb = worldAABB(position, kindId);
    // Bottom-center: X-center of AABB, Y at AABB bottom, Z-center of AABB.
    return [
      (aabb.min[0] + aabb.max[0]) / 2,
      aabb.min[1],
      (aabb.min[2] + aabb.max[2]) / 2,
    ];
  }

  function voxelFootprint(position: Vec3, kindId: string): VoxelFootprint {
    const aabb = worldAABB(position, kindId);
    // Half-open voxel range: floor(min/vs) .. ceil(max/vs). Small epsilon
    // absorbs floating-point AABBs whose min is mathematically on a voxel
    // boundary but computed as boundary - 1e-15.
    const EPS = 1e-9;
    return {
      min: [
        Math.floor(aabb.min[0] / voxelSize + EPS),
        Math.floor(aabb.min[1] / voxelSize + EPS),
        Math.floor(aabb.min[2] / voxelSize + EPS),
      ],
      max: [
        Math.ceil(aabb.max[0] / voxelSize - EPS),
        Math.ceil(aabb.max[1] / voxelSize - EPS),
        Math.ceil(aabb.max[2] / voxelSize - EPS),
      ],
    };
  }

  function tileStep(kindId: string): Vec3 {
    const dims = dimsFor(kindId);
    return [
      Math.max(1, Math.round(dims.width / voxelSize)),
      Math.max(1, Math.round(dims.height / voxelSize)),
      Math.max(1, Math.round(dims.depth / voxelSize)),
    ];
  }

  return {
    voxelSize,
    worldAABB,
    worldAABBOfInstance,
    meshOrigin,
    voxelFootprint,
    tileStep,
  };
}
