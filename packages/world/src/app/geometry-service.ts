/**
 * Default implementation of `InstanceGeometryService`. Pure math; the only
 * dependency is a `CatalogService` from which it reads `kind.dimensions`
 * and `kind.localAABB`.
 *
 * Convention (the single source of truth across renderer / colliders /
 * outline / occupancy / snap / drop):
 *
 *   - voxel position * voxelSize = the world-space lower-left-bottom
 *     corner of the object's unrotated AABB. So a 2 m Blue cube at voxel
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
  MeshTransform,
  Vec3,
  VoxelFootprint,
  WorldAABB,
} from './types.ts';
import type { ObjectInstance } from '@officexr/sdk';
import type { WorldObjectKind } from '../scenes/world-object-kinds-schema.ts';
import { normalizeYawDeg } from '../scenes/commands.ts';

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

/** Magic kind-id prefix for the Mugshot's primitive-box diagnostic
 * (rendered by ObjectInstances' `PrimitiveInstanceGroup`). These ids
 * are NOT in the catalog, so without the special-case in `worldAABB`
 * below they'd fall back to a one-voxel cube and the collider would be
 * far smaller than the 2 m visible box — under gravity the character
 * falls straight through it. Single source of truth; ObjectInstances
 * imports these. */
export const PRIMITIVE_KIND_PREFIX = '__primitive_';
/** Physical size (m) of a primitive diagnostic box — mirrors the 2 m
 * KayKit blocks (`colored_block_blue` / `stone`) it stands in for, so
 * the collider matches the mesh exactly. */
export const PRIMITIVE_BLOCK_SIZE = 2;

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

/** Size (m) the tile step derives from: `dimensions`, else `localAABB`. */
function kindSize(kind: WorldObjectKind | undefined): Vec3 | undefined {
  if (kind?.dimensions) {
    const { width, height, depth } = kind.dimensions;
    return [width, height, depth];
  }
  if (kind?.localAABB) {
    const { min, max } = kind.localAABB;
    return [max.x - min.x, max.y - min.y, max.z - min.z];
  }
  return undefined;
}

function yawRadians(yawDeg: number): number {
  return (normalizeYawDeg(yawDeg) * Math.PI) / 180;
}

/** cos and sin of a yaw, rounded so quarter turns come out exact. */
function cosSin(yawDeg: number): [number, number] {
  const rad = yawRadians(yawDeg);
  const round = (v: number) => Math.round(v * 1e12) / 1e12;
  return [round(Math.cos(rad)), round(Math.sin(rad))];
}

/** X/Z extents of the axis-aligned box around an `x` × `z` rectangle
 * yawed by `yawDeg`. Works on half or full extents alike. */
function rotatedExtentsXZ(x: number, z: number, yawDeg: number): [number, number] {
  const [cos, sin] = cosSin(yawDeg).map(Math.abs);
  return [x * cos + z * sin, x * sin + z * cos];
}

export function createInstanceGeometry(deps: {
  catalog: KindResolver;
  voxelSize: number;
}): InstanceGeometryService {
  const { catalog, voxelSize } = deps;
  if (voxelSize <= 0) {
    throw new Error(`createInstanceGeometry: voxelSize must be > 0, got ${voxelSize}`);
  }

  function localAABBOf(kindId: string): LocalAABB {
    // Mugshot primitive-box diagnostic: the box isn't a catalog kind,
    // so derive its box straight from PRIMITIVE_BLOCK_SIZE (the same
    // size the mesh renders, centred on its root) instead of the
    // one-voxel fallback, so colliders match across cube modes.
    if (kindId.startsWith(PRIMITIVE_KIND_PREFIX)) {
      const half = PRIMITIVE_BLOCK_SIZE / 2;
      return { min: { x: -half, y: -half, z: -half }, max: { x: half, y: half, z: half } };
    }
    return localAABBFor(catalog.getKind(kindId), voxelSize);
  }

  function unrotatedAABB(position: Vec3, kindId: string): WorldAABB {
    const ox = position[0] * voxelSize;
    const oy = position[1] * voxelSize;
    const oz = position[2] * voxelSize;
    const local = localAABBOf(kindId);
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

  function worldAABB(position: Vec3, kindId: string, yawDeg = 0): WorldAABB {
    const box = unrotatedAABB(position, kindId);
    if (normalizeYawDeg(yawDeg) === 0) return box;
    const cx = (box.min[0] + box.max[0]) / 2;
    const cz = (box.min[2] + box.max[2]) / 2;
    const [hx, hz] = rotatedExtentsXZ(
      (box.max[0] - box.min[0]) / 2,
      (box.max[2] - box.min[2]) / 2,
      yawDeg,
    );
    return {
      min: [cx - hx, box.min[1], cz - hz],
      max: [cx + hx, box.max[1], cz + hz],
    };
  }

  function worldAABBOfInstance(instance: ObjectInstance): WorldAABB {
    return worldAABB(instance.position, instance.kindId, instance.yawDeg);
  }

  function meshOrigin(position: Vec3, kindId: string): Vec3 {
    const local = localAABBOf(kindId);
    // The mesh's local-AABB lower-left-bottom = `local.min`. To place
    // it at world position*vs, the mesh root must be at:
    //   meshRoot = world_lower_left - local.min
    const ox = position[0] * voxelSize;
    const oy = position[1] * voxelSize;
    const oz = position[2] * voxelSize;
    return [ox - local.min.x, oy - local.min.y, oz - local.min.z];
  }

  function meshTransform(position: Vec3, kindId: string, yawDeg = 0): MeshTransform {
    const rotationY = yawRadians(yawDeg);
    const origin = meshOrigin(position, kindId);
    if (rotationY === 0) return { position: origin, rotationY };
    // Spin the mesh root about the unrotated footprint's centre: the
    // centre's offset from the root, rotated, must still land on it.
    const local = localAABBOf(kindId);
    const lx = (local.min.x + local.max.x) / 2;
    const lz = (local.min.z + local.max.z) / 2;
    const [cos, sin] = cosSin(yawDeg);
    return {
      position: [
        origin[0] + lx - (lx * cos + lz * sin),
        origin[1],
        origin[2] + lz - (-lx * sin + lz * cos),
      ],
      rotationY,
    };
  }

  function voxelFootprint(position: Vec3, kindId: string, yawDeg = 0): VoxelFootprint {
    const aabb = worldAABB(position, kindId, yawDeg);
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

  function tileStep(kindId: string, yawDeg = 0): Vec3 {
    const size = kindSize(catalog.getKind(kindId));
    if (!size) return [1, 1, 1];
    const [w, d] = rotatedExtentsXZ(size[0], size[2], yawDeg);
    return [
      Math.max(1, Math.round(w / voxelSize)),
      Math.max(1, Math.round(size[1] / voxelSize)),
      Math.max(1, Math.round(d / voxelSize)),
    ];
  }

  return {
    voxelSize,
    worldAABB,
    worldAABBOfInstance,
    meshOrigin,
    meshTransform,
    voxelFootprint,
    tileStep,
  };
}
