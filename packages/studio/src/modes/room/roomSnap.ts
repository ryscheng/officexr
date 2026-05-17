/**
 * Pure helpers for the Room editor's "snap to grid OR snap to object
 * face" placement model.
 *
 * The Room editor's interactive canvas fires pointer events that the
 * caller resolves to either an empty-floor hit (just a world-space
 * point on y = 0) or an object hit (a hit point, the hit face's normal,
 * and the object's voxel position). This module turns either of those
 * into a target voxel coord:
 *
 *   - Floor hit  → `(round(x / voxelSize), 0, round(z / voxelSize))`.
 *     Used for placing the first object in an empty room.
 *   - Cube hit   → `cubePosition + quantizedFaceNormal`. The face
 *     normal gets quantized to the nearest cardinal axis to defend
 *     against floating-point noise from chained transforms.
 *
 * The user spec says "Once a single object is placed on the editor,
 * additional objects being placed should snap to other objects."
 * That falls out automatically — once an object exists, the raycaster's
 * closest hit can be either the object or the floor; whichever wins,
 * `snapToVoxel` produces a reasonable target.
 */

export interface FloorHit {
  kind: 'floor';
  /** World-space point of the raycast hit on the y = 0 plane. */
  point: { x: number; y: number; z: number };
}

export interface CubeHit {
  kind: 'cube';
  /** Voxel position of the object that was hit. */
  cubePosition: readonly [number, number, number];
  /** Face normal in world space. May have floating-point noise; we
   * quantize internally before use. */
  faceNormal: readonly [number, number, number];
}

export type SnapHit = FloorHit | CubeHit;

/**
 * Computes the tile step (in voxels) for an object dimension.
 * Returns `Math.max(1, Math.round(dimensionM / voxelSize))`.
 * Minimum is 1 to ensure at least one voxel of movement.
 */
export function computeTileStep(dimensionM: number, voxelSize: number): number {
  return Math.max(1, Math.round(dimensionM / voxelSize));
}

/**
 * Computes per-axis tile steps from the kind's bounding dimensions.
 */
export function computeKindTileSteps(
  dims: { width: number; height: number; depth: number },
  voxelSize: number,
): { x: number; y: number; z: number } {
  return {
    x: computeTileStep(dims.width, voxelSize),
    y: computeTileStep(dims.height, voxelSize),
    z: computeTileStep(dims.depth, voxelSize),
  };
}

/**
 * Returns the target voxel coords for a snap hit.
 *
 * @param hit - The raycast hit (floor or cube face).
 * @param voxelSize - The grid voxel size in metres.
 * @param step - Optional per-axis step multiplier. When provided, floor hits
 *   snap to the nearest multiple of each step (e.g. step.x=4 snaps to 0, 4, 8…).
 *   Defaults to {x:1, y:1, z:1} (existing behavior).
 */
export function snapToVoxel(
  hit: SnapHit,
  voxelSize: number,
  step?: { x: number; y: number; z: number },
): [number, number, number] {
  if (hit.kind === 'cube') {
    const n = quantizeAxisAlignedNormal(hit.faceNormal);
    return [
      hit.cubePosition[0] + n[0],
      hit.cubePosition[1] + n[1],
      hit.cubePosition[2] + n[2],
    ];
  }
  const sx = step?.x ?? 1;
  const sz = step?.z ?? 1;
  return [
    Math.round(hit.point.x / voxelSize / sx) * sx,
    0,
    Math.round(hit.point.z / voxelSize / sz) * sz,
  ];
}

/**
 * Quantize a 3D vector to its dominant axis as a `±1` along one axis,
 * `0` on the others. KayKit blocks are axis-aligned, so a clean hit
 * produces a normal that's already very close to a cardinal axis;
 * this step removes the residual float noise so the resulting target
 * voxel stays integer.
 */
export function quantizeAxisAlignedNormal(
  n: readonly [number, number, number],
): [number, number, number] {
  const ax = Math.abs(n[0]);
  const ay = Math.abs(n[1]);
  const az = Math.abs(n[2]);
  if (ax >= ay && ax >= az) {
    const s = Math.sign(n[0]);
    return [s === 0 ? 1 : s, 0, 0];
  }
  if (ay >= ax && ay >= az) {
    const s = Math.sign(n[1]);
    return [0, s === 0 ? 1 : s, 0];
  }
  const s = Math.sign(n[2]);
  return [0, 0, s === 0 ? 1 : s];
}
