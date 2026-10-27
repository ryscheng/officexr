import type { InstanceGeometryService } from '@officexr/world/app';

type Vec3 = readonly [number, number, number];

/** Voxel-grid box; `max` is exclusive. */
export interface VoxelBox {
  readonly min: Vec3;
  readonly max: Vec3;
}

/** Voxel box occupied by an object of `kindId` at `position`, turned by `yawDeg`. */
export type FootprintOf = (position: Vec3, kindId: string, yawDeg?: number) => VoxelBox;

/** One voxel at `position`, for callers with no catalog. */
export const unitFootprint = (position: Vec3): VoxelBox => ({
  min: position,
  max: [position[0] + 1, position[1] + 1, position[2] + 1],
});

// Ties go up so a half-voxel pivot offset rounds the same way whatever float noise the catalog sizes carry.
const roundHalfUp = (v: number) => Math.floor(v + 0.5 + 1e-6);

/**
 * Footprints for the editors' occupancy, snap and drop math, derived from the
 * geometry service so they follow the object's yaw. The box is the rotated
 * world AABB snapped to the grid: `tileStep` size, nearest-voxel origin. At
 * yaw 0 that is `position` plus the tile step. Rotating about the footprint
 * centre puts it on a half voxel when width and depth differ by an odd voxel
 * count, so there the box is off the exact AABB by half a voxel toward +x/+z.
 */
export function createFootprintOf(
  geometry: Pick<InstanceGeometryService, 'voxelSize' | 'worldAABB' | 'tileStep'>,
): FootprintOf {
  const { voxelSize } = geometry;
  return (position, kindId, yawDeg = 0) => {
    const size = geometry.tileStep(kindId, yawDeg);
    const { min } = geometry.worldAABB(position, kindId, yawDeg);
    const lo = [
      roundHalfUp(min[0] / voxelSize),
      roundHalfUp(min[1] / voxelSize),
      roundHalfUp(min[2] / voxelSize),
    ] as const;
    return { min: lo, max: [lo[0] + size[0], lo[1] + size[1], lo[2] + size[2]] };
  };
}
