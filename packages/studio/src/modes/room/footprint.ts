import type { InstanceGeometryService, VoxelFootprint } from '@officexr/world/app';
import type { NewObjectShape } from './roomSnap.ts';

type Vec3 = readonly [number, number, number];

/** Voxel box occupied by an object of `kindId` at `position`, turned by `yawDeg`. */
export type FootprintOf = (position: Vec3, kindId: string, yawDeg?: number) => VoxelFootprint;

/**
 * Nearest voxel to a metre coordinate. Ties go up so a half-voxel offset rounds
 * the same way whatever float noise the catalog sizes carry; every metre-to-voxel
 * conversion in the placement math uses it so snaps and footprints agree.
 */
export const metresToVoxel = (m: number, voxelSize: number) =>
  Math.floor(m / voxelSize + 0.5 + 1e-6);

/**
 * Footprints for the editors' occupancy, snap and drop math, derived from the
 * geometry service so they follow the object's yaw. The box is the rotated
 * world AABB snapped to the grid: `tileStep` size, nearest-voxel origin, so at
 * yaw 0 it is `position` plus the tile step.
 */
export function createFootprintOf(
  geometry: Pick<InstanceGeometryService, 'voxelSize' | 'worldAABB' | 'tileStep'>,
): FootprintOf {
  const { voxelSize } = geometry;
  return (position, kindId, yawDeg = 0) => {
    const size = geometry.tileStep(kindId, yawDeg);
    const { min } = geometry.worldAABB(position, kindId, yawDeg);
    // ponytail: min and size round separately; past quarter turns (e.g. a 45° step) `max` can land a whole voxel off.
    const lo = [
      metresToVoxel(min[0], voxelSize),
      metresToVoxel(min[1], voxelSize),
      metresToVoxel(min[2], voxelSize),
    ] as const;
    return { min: lo, max: [lo[0] + size[0], lo[1] + size[1], lo[2] + size[2]] };
  };
}

/** The staged object's box for `snapToNearestFace`: metre extents of its yawed AABB, tile step and footprint offset. */
export function newObjectShape(
  geometry: Pick<InstanceGeometryService, 'voxelSize' | 'worldAABB' | 'tileStep'>,
  kindId: string,
  yawDeg = 0,
): NewObjectShape & Required<Pick<NewObjectShape, 'originOffset'>> {
  const { min, max } = geometry.worldAABB([0, 0, 0], kindId, yawDeg);
  const [x, y, z] = geometry.tileStep(kindId, yawDeg);
  return {
    width: max[0] - min[0],
    height: max[1] - min[1],
    depth: max[2] - min[2],
    step: { x, y, z },
    originOffset: createFootprintOf(geometry)([0, 0, 0], kindId, yawDeg).min,
  };
}

/** Whether `box` shares any voxel with an instance's footprint (half-open boxes). */
export function overlapsAnyInstance(
  box: VoxelFootprint,
  instances: ReadonlyArray<{ position: Vec3; kindId: string; yawDeg?: number }>,
  footprintOf: FootprintOf,
): boolean {
  return instances.some((inst) => {
    const fp = footprintOf(inst.position, inst.kindId, inst.yawDeg);
    return [0, 1, 2].every((i) => box.max[i] > fp.min[i] && box.min[i] < fp.max[i]);
  });
}
