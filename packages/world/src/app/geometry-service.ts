/**
 * Default implementation of `InstanceGeometryService`. Pure math; the only
 * dependency is a `CatalogService` from which it reads `kind.dimensions`
 * and `kind.localAABB`.
 *
 * Convention (the single source of truth across renderer / colliders /
 * outline / occupancy / snap / drop):
 *
 *   - voxel position * voxelSize = the world-space lower-left-bottom
 *     corner of the object's AABB. So a 2 m Blue cube at voxel
 *     (0, 0, 0) on a 0.5 m grid occupies world (0, 0, 0) → (2, 2, 2).
 *     Two cubes at voxel.x = 0 and voxel.x = 4 are flush adjacent at
 *     world x = 2.
 *   - `meshOrigin(position)` translates the GLTF mesh so that its
 *     local-AABB lower-left-bottom lands at the voxel position. This
 *     normalizes the mesh's local origin convention — Blue's GLTF is
 *     fully centered (local AABB -1..1 on all axes); Cube Prototype
 *     Large A's GLTF is X/Z-centered, Y-bottom (-2..2 X/Z, 0..4 Y).
 *     The geometry service hides that difference behind one canonical
 *     world AABB.
 *   - Fallbacks (kind not in catalog OR no localAABB baked):
 *       * `kind.dimensions` present, `localAABB` absent → assume
 *         X/Z-centered + Y-bottom (the prototype-cube pattern, which
 *         is most kinds after the asset-pack install).
 *       * Both absent → a one-voxel cube centered on origin in Y.
 */

import type {
  InstanceGeometryService,
  Vec3,
  VoxelFootprint,
  WorldAABB,
} from './types.ts';
import type { ObjectInstance } from '@officexr/sdk';
import type { WorldObjectKind } from '../scenes/world-object-kinds-schema.ts';

/**
 * Minimum-surface dependency the geometry service needs from a catalog.
 * ISP (Interface Segregation): the geometry service only ever calls
 * `getKind(id)` — callers that want to construct one (Node CLI, tests,
 * the bake service) shouldn't have to mock the full `CatalogService`.
 */
export interface KindResolver {
  getKind(id: string): WorldObjectKind | undefined;
}

interface LocalAABB {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

function localAABBFor(kind: WorldObjectKind | undefined, voxelSize: number): LocalAABB {
  if (kind?.localAABB) return kind.localAABB;
  // Fallback 1: dimensions present, origin convention unknown — assume
  // X/Z-centered, Y-bottom (the prototype-cube / KayKit-Furniture default).
  if (kind?.dimensions) {
    const { width, height, depth } = kind.dimensions;
    return {
      min: { x: -width / 2, y: 0, z: -depth / 2 },
      max: { x: width / 2, y: height, z: depth / 2 },
    };
  }
  // Fallback 2: nothing known. One voxel cell centered on X/Z origin,
  // Y-bottom — same convention as the previous geometry service.
  const half = voxelSize / 2;
  return {
    min: { x: -half, y: 0, z: -half },
    max: { x: half, y: voxelSize, z: half },
  };
}

export function createInstanceGeometry(deps: {
  catalog: KindResolver;
  voxelSize: number;
}): InstanceGeometryService {
  const { catalog, voxelSize } = deps;
  if (voxelSize <= 0) {
    throw new Error(`createInstanceGeometry: voxelSize must be > 0, got ${voxelSize}`);
  }

  function worldAABB(position: Vec3, kindId: string): WorldAABB {
    const kind = catalog.getKind(kindId);
    const local = localAABBFor(kind, voxelSize);
    const ox = position[0] * voxelSize;
    const oy = position[1] * voxelSize;
    const oz = position[2] * voxelSize;
    // Anchor lower-left-bottom: the world AABB's MIN sits at position*vs.
    return {
      min: [ox, oy, oz],
      max: [
        ox + (local.max.x - local.min.x),
        oy + (local.max.y - local.min.y),
        oz + (local.max.z - local.min.z),
      ],
    };
  }

  function worldAABBOfInstance(instance: ObjectInstance): WorldAABB {
    return worldAABB(instance.position, instance.kindId);
  }

  function meshOrigin(position: Vec3, kindId: string): Vec3 {
    const kind = catalog.getKind(kindId);
    const local = localAABBFor(kind, voxelSize);
    // The mesh's local-AABB lower-left-bottom = `local.min`. To place
    // it at world position*vs, the mesh root must be at:
    //   meshRoot = world_lower_left - local.min
    const ox = position[0] * voxelSize;
    const oy = position[1] * voxelSize;
    const oz = position[2] * voxelSize;
    return [ox - local.min.x, oy - local.min.y, oz - local.min.z];
  }

  function voxelFootprint(position: Vec3, kindId: string): VoxelFootprint {
    const aabb = worldAABB(position, kindId);
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
    const kind = catalog.getKind(kindId);
    if (kind?.dimensions) {
      return [
        Math.max(1, Math.round(kind.dimensions.width / voxelSize)),
        Math.max(1, Math.round(kind.dimensions.height / voxelSize)),
        Math.max(1, Math.round(kind.dimensions.depth / voxelSize)),
      ];
    }
    if (kind?.localAABB) {
      const { min, max } = kind.localAABB;
      return [
        Math.max(1, Math.round((max.x - min.x) / voxelSize)),
        Math.max(1, Math.round((max.y - min.y) / voxelSize)),
        Math.max(1, Math.round((max.z - min.z) / voxelSize)),
      ];
    }
    return [1, 1, 1];
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
