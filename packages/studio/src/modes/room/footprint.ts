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

/** How close (in voxels) an extent must be to a whole number to count as
 * grid-sized; absorbs the float noise real catalog bakes carry. */
const WHOLE_EXTENT_TOLERANCE = 1e-3;

/**
 * Footprints for the editors' occupancy, snap and drop math, derived from the
 * geometry service so they follow the object's yaw. Boxes are in voxels and
 * half-open.
 *
 * Per axis there are two regimes:
 *   - **Grid**: the position on that axis is a whole voxel and the object's
 *     extent along it is a whole number of voxels. The box is the rotated world
 *     AABB snapped to the grid: `tileStep` size, nearest-voxel origin, so at
 *     yaw 0 it is `position` plus the tile step. Every pre-sub-grid placement
 *     of a grid-sized kind stays here, unchanged.
 *   - **Exact**: otherwise (a sub-grid position, or a kind such as a 0.15 m
 *     floor tile whose extent is not whole voxels) the box is the exact world
 *     AABB in fractional voxels, so a rug at y = 0.3 sits on that tile instead
 *     of "overlapping" a whole-voxel box around it.
 */
export function createFootprintOf(
  geometry: Pick<InstanceGeometryService, 'voxelSize' | 'worldAABB' | 'tileStep'>,
): FootprintOf {
  const { voxelSize } = geometry;
  return (position, kindId, yawDeg = 0) => {
    const size = geometry.tileStep(kindId, yawDeg);
    const { min, max } = geometry.worldAABB(position, kindId, yawDeg);
    const lo: [number, number, number] = [0, 0, 0];
    const hi: [number, number, number] = [0, 0, 0];
    for (const a of [0, 1, 2] as const) {
      const exactLo = min[a] / voxelSize;
      const exactHi = max[a] / voxelSize;
      const extent = exactHi - exactLo;
      const wholeExtent = Math.abs(extent - Math.round(extent)) < WHOLE_EXTENT_TOLERANCE;
      if (Number.isInteger(position[a]) && wholeExtent) {
        // ponytail: min and size round separately; past quarter turns (e.g. a 45° step) `max` can land a whole voxel off.
        lo[a] = metresToVoxel(min[a], voxelSize);
        hi[a] = lo[a] + size[a];
      } else {
        lo[a] = exactLo;
        hi[a] = exactHi;
      }
    }
    return { min: lo, max: hi };
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

/** Tolerance (voxels) for touching boxes: two boxes that only share a face,
 * up to float noise, do not overlap. */
const OVERLAP_EPS = 1e-6;

/** Whether two half-open voxel boxes share any volume (touching faces don't count). */
export function boxesOverlap(a: VoxelFootprint, b: VoxelFootprint): boolean {
  return [0, 1, 2].every((i) => a.max[i] > b.min[i] + OVERLAP_EPS && a.min[i] < b.max[i] - OVERLAP_EPS);
}

/** Whether `box` shares any volume with an instance's footprint (half-open boxes). */
export function overlapsAnyInstance(
  box: VoxelFootprint,
  instances: ReadonlyArray<{ position: Vec3; kindId: string; yawDeg?: number }>,
  footprintOf: FootprintOf,
): boolean {
  return instances.some((inst) => boxesOverlap(box, footprintOf(inst.position, inst.kindId, inst.yawDeg)));
}
