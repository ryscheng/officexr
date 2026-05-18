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
  /** Kind id of the target object. Used by `snapToVoxel` to step by
   * the target's per-axis voxel stride (so a new cube placed against
   * a 2 m cube's +X face clears the target's full footprint, not just
   * one 0.5 m voxel). */
  kindId: string;
  /** Actual world-space coordinates of the raycast hit point on the
   * cube's face. Used by `snapToNearestFace` to decide which side of
   * the cube the cursor is on (e.g. hovering the TOP needs the hit's
   * world Y at the top face, not the cube's anchor Y). */
  point: { x: number; y: number; z: number };
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
 * @param targetStride - Optional per-axis voxel stride of the *target*
 *   object when `hit.kind === 'cube'`. Used to offset the new position
 *   past the target's full footprint along the face normal. Defaults
 *   to {x:1, y:1, z:1} (the pre-stride behaviour, which is wrong for
 *   any kind larger than one voxel — pass the lookup-derived stride
 *   from `getKindStride(hit.kindId, voxelSize)`).
 */
export function snapToVoxel(
  hit: SnapHit,
  voxelSize: number,
  step?: { x: number; y: number; z: number },
  targetStride?: { x: number; y: number; z: number },
): [number, number, number] {
  if (hit.kind === 'cube') {
    const n = quantizeAxisAlignedNormal(hit.faceNormal);
    const tx = targetStride?.x ?? 1;
    const ty = targetStride?.y ?? 1;
    const tz = targetStride?.z ?? 1;
    // For a +axis face, step by the target's full extent so the new
    // object sits just past the target's last voxel. For a -axis face,
    // the new object's anchor is one stride below the target — its top
    // face lands flush against the target's bottom face.
    return [
      hit.cubePosition[0] + n[0] * tx,
      hit.cubePosition[1] + n[1] * ty,
      hit.cubePosition[2] + n[2] * tz,
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

/** Info about an existing placed object for snap-to-face computation.
 * Always carries the object's full world-space AABB (computed by the
 * canonical geometry service) so the snap math stays agnostic to GLTF
 * origin conventions. */
export interface NearbyObjectInfo {
  /** Voxel position of the placed object. */
  position: readonly [number, number, number];
  /** World-space AABB of the placed object, in metres. */
  aabb: {
    min: readonly [number, number, number];
    max: readonly [number, number, number];
  };
}

/** @deprecated Use NearbyObjectInfo. Old shape used dims (extents)
 * + assumed X/Z-centered + Y-bottom origin convention which no longer
 * holds since per-kind GLTF origins vary. */
export interface TileableObjectInfo {
  position: readonly [number, number, number];
  dims: { width: number; height: number; depth: number };
}

/**
 * Snaps a non-tileable object to the face of the nearest tileable placed
 * object. Falls back to the 0.5 m world grid when no tileable object exists
 * within `fallbackRadiusM` metres (default 5).
 *
 * Pure function — no React, no THREE, no side effects.
 *
 * Algorithm:
 *  1. Find the nearest tileable object by Euclidean distance from
 *     `hitWorldPoint` to each tileable object's world-space centre
 *     (`pos[i] * voxelSize`).
 *  2. If the nearest is farther than `fallbackRadiusM`, return the
 *     world-grid snap: `[round(x/vs), round(y/vs), round(z/vs)]`.
 *  3. Otherwise find which of the tileable object's 6 AABB faces is
 *     closest to `hitWorldPoint`, then position the non-tileable
 *     object so its nearest face is flush with that face.
 *
 * AABB conventions (object at voxel [vx, vy, vz] with dims {w, h, d}):
 *   +X face: vx*vs + w/2   -X face: vx*vs - w/2
 *   +Y face: vy*vs + h      -Y face: vy*vs
 *   +Z face: vz*vs + d/2   -Z face: vz*vs - d/2
 * (The Y axis is bottom-anchored — voxel y is the bottom of the object.)
 */
export function snapToNearestTileableFace(
  hitWorldPoint: { x: number; y: number; z: number },
  nonTileableDims: { width: number; height: number; depth: number },
  tileableObjects: readonly TileableObjectInfo[],
  voxelSize: number,
  fallbackRadiusM = 5,
): [number, number, number] {
  // World-grid fallback
  const fallback: [number, number, number] = [
    Math.round(hitWorldPoint.x / voxelSize),
    Math.round(hitWorldPoint.y / voxelSize),
    Math.round(hitWorldPoint.z / voxelSize),
  ];

  if (tileableObjects.length === 0) return fallback;

  // Find nearest tileable object by distance from hit point to object centre
  let nearestObj: TileableObjectInfo | null = null;
  let nearestDist = Infinity;
  for (const obj of tileableObjects) {
    const cx = obj.position[0] * voxelSize;
    const cy = obj.position[1] * voxelSize + obj.dims.height / 2;
    const cz = obj.position[2] * voxelSize;
    const dx = hitWorldPoint.x - cx;
    const dy = hitWorldPoint.y - cy;
    const dz = hitWorldPoint.z - cz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestObj = obj;
    }
  }

  if (!nearestObj || nearestDist > fallbackRadiusM) return fallback;

  const obj = nearestObj;
  const vx = obj.position[0] * voxelSize;
  const vy = obj.position[1] * voxelSize;
  const vz = obj.position[2] * voxelSize;
  const { width: ow, height: oh, depth: od } = obj.dims;
  const { width: nw, height: nh, depth: nd } = nonTileableDims;

  // Six faces of the tileable object's AABB and corresponding flush placement
  // for the non-tileable object. For each face, we compute the distance from
  // hitWorldPoint to the face plane, then choose the closest.
  const faces: Array<{
    dist: number;
    // world-space centre of the non-tileable object when flush with this face
    cx: number;
    cy: number;
    cz: number;
  }> = [
    // +X face: faceX = vx + ow/2; non-tileable -X face at faceX → centre at faceX + nw/2
    { dist: Math.abs(hitWorldPoint.x - (vx + ow / 2)), cx: vx + ow / 2 + nw / 2, cy: hitWorldPoint.y, cz: hitWorldPoint.z },
    // -X face: faceX = vx - ow/2; non-tileable +X face at faceX → centre at faceX - nw/2
    { dist: Math.abs(hitWorldPoint.x - (vx - ow / 2)), cx: vx - ow / 2 - nw / 2, cy: hitWorldPoint.y, cz: hitWorldPoint.z },
    // +Y face: faceY = vy + oh; non-tileable -Y face at faceY → centre at faceY + nh/2
    { dist: Math.abs(hitWorldPoint.y - (vy + oh)), cx: hitWorldPoint.x, cy: vy + oh + nh / 2, cz: hitWorldPoint.z },
    // -Y face: faceY = vy; non-tileable +Y face at faceY → centre at faceY - nh/2
    { dist: Math.abs(hitWorldPoint.y - vy), cx: hitWorldPoint.x, cy: vy - nh / 2, cz: hitWorldPoint.z },
    // +Z face: faceZ = vz + od/2; non-tileable -Z face at faceZ → centre at faceZ + nd/2
    { dist: Math.abs(hitWorldPoint.z - (vz + od / 2)), cx: hitWorldPoint.x, cy: hitWorldPoint.y, cz: vz + od / 2 + nd / 2 },
    // -Z face: faceZ = vz - od/2; non-tileable +Z face at faceZ → centre at faceZ - nd/2
    { dist: Math.abs(hitWorldPoint.z - (vz - od / 2)), cx: hitWorldPoint.x, cy: hitWorldPoint.y, cz: vz - od / 2 - nd / 2 },
  ];

  // Find the closest face
  let bestFace = faces[0];
  for (const face of faces) {
    if (face.dist < bestFace.dist) bestFace = face;
  }

  // Convert world-space centre to voxel coords
  return [
    Math.round(bestFace.cx / voxelSize),
    Math.round(bestFace.cy / voxelSize),
    Math.round(bestFace.cz / voxelSize),
  ];
}

// ---------------------------------------------------------------------------
// snapToNearestFace — anchor-convention-correct, works for ANY kind
// ---------------------------------------------------------------------------

/**
 * Place the new object flush against the nearest existing object's
 * face. Operates entirely in world-space AABBs (supplied by the
 * canonical InstanceGeometryService) so the math is agnostic to GLTF
 * origin conventions — pin-aligned with the renderer + wireframe.
 *
 * Algorithm:
 *   1. For each existing object, find the closest of its 6 faces to
 *      the cursor's world-space hit point.
 *   2. For each face, compute the new object's voxel-anchor position
 *      that would put its OPPOSITE face flush with the existing
 *      object's face.
 *   3. Pick the (object, face) pair with the smallest cursor distance
 *      AND within `pullRadiusM`. Return that voxel position.
 *   4. Fall back to `null` when no object is within range; callers
 *      then defer to grid snap.
 *
 * The new object's world AABB at voxel `[vx, vy, vz]` is computed by
 * the geometry service as `(vx*vs, vy*vs, vz*vs)` →
 * `(vx*vs + nw, vy*vs + nh, vz*vs + nd)` where (nw,nh,nd) = new object's
 * extents. Voxel position = world_anchor / voxelSize, since
 * `vx*vs = world_anchor.x` etc.
 */
export interface NewObjectShape {
  /** New object's world-space extents in metres (width × height × depth). */
  width: number;
  height: number;
  depth: number;
  /** New object's voxel-step per axis. The snapped voxel is rounded
   * to the nearest multiple of step so two same-kind cubes line up on
   * the same grid. */
  step: { x: number; y: number; z: number };
}

type Face = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';

const EPS = 1e-6;

/** Distance from a 3D point to an axis-aligned bounding box (clamped to
 * the nearest point on the AABB, then Euclidean distance). Zero when
 * the point is inside or on the AABB. */
function distanceToAABB(
  p: { x: number; y: number; z: number },
  aabb: { min: readonly number[]; max: readonly number[] },
): number {
  const dx = Math.max(aabb.min[0] - p.x, 0, p.x - aabb.max[0]);
  const dy = Math.max(aabb.min[1] - p.y, 0, p.y - aabb.max[1]);
  const dz = Math.max(aabb.min[2] - p.z, 0, p.z - aabb.max[2]);
  return Math.hypot(dx, dy, dz);
}

/** Pick the face of `aabb` the user most likely wants to attach to.
 *
 * For a cursor OUTSIDE the AABB on any axis, that axis wins (cursor
 * is "past" the +/- face on that axis). For ties (corner / inside
 * regions) the Y axis wins, and the +/- preference comes from the
 * VIEWING DIRECTION:
 *   - Camera looking DOWN at the object (cameraY > cube center) →
 *     prefer ABOVE so the new object lands closer to the camera.
 *   - Camera looking UP (cameraY < cube center) → prefer BELOW.
 *   - No camera info or camera level with the cube → fall back to
 *     the cursor's Y position relative to the cube centre. */
function pickDominantFace(
  cursor: { x: number; y: number; z: number },
  aabb: { min: readonly number[]; max: readonly number[] },
  cameraY?: number,
): Face {
  const cx = (aabb.min[0] + aabb.max[0]) / 2;
  const cy = (aabb.min[1] + aabb.max[1]) / 2;
  const cz = (aabb.min[2] + aabb.max[2]) / 2;
  const hw = Math.max(EPS, (aabb.max[0] - aabb.min[0]) / 2);
  const hh = Math.max(EPS, (aabb.max[1] - aabb.min[1]) / 2);
  const hd = Math.max(EPS, (aabb.max[2] - aabb.min[2]) / 2);

  // Normalize so a "1.0" value on any axis means "exactly at the face."
  const nx = (cursor.x - cx) / hw;
  const ny = (cursor.y - cy) / hh;
  const nz = (cursor.z - cz) / hd;

  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);

  if (ay >= ax && ay >= az) {
    // Y is dominant or tied. Pick +Y / -Y by the camera's viewing
    // direction when supplied (the visible side wins). When the
    // cursor is clearly above or below the cube the sign is
    // unambiguous regardless of camera angle — only the inside-cube
    // / tie case relies on the camera hint.
    if (ay > EPS) return ny > 0 ? '+y' : '-y';
    if (cameraY !== undefined) return cameraY >= cy ? '+y' : '-y';
    return '+y';
  }
  if (ax >= az) return nx >= 0 ? '+x' : '-x';
  return nz >= 0 ? '+z' : '-z';
}

/** New object's anchor (world coords, lower-left-bottom) so its AABB
 * sits flush against the given face of `aabb`. Non-face axes keep the
 * cursor's coords so the new object follows the cursor along the face. */
function computeFlushAnchor(
  face: Face,
  aabb: { min: readonly number[]; max: readonly number[] },
  cursor: { x: number; y: number; z: number },
  newObject: NewObjectShape,
): [number, number, number] {
  const cy = Math.max(cursor.y, aabb.min[1]);
  switch (face) {
    case '+x':
      return [aabb.max[0], cy, cursor.z - newObject.depth / 2];
    case '-x':
      return [aabb.min[0] - newObject.width, cy, cursor.z - newObject.depth / 2];
    case '+y':
      return [
        cursor.x - newObject.width / 2,
        aabb.max[1],
        cursor.z - newObject.depth / 2,
      ];
    case '-y':
      return [
        cursor.x - newObject.width / 2,
        aabb.min[1] - newObject.height,
        cursor.z - newObject.depth / 2,
      ];
    case '+z':
      return [cursor.x - newObject.width / 2, cy, aabb.max[2]];
    case '-z':
      return [
        cursor.x - newObject.width / 2,
        cy,
        aabb.min[2] - newObject.depth,
      ];
  }
}

export interface SnapViewport {
  /** Camera world-Y. Used to bias the stack-above-or-below tie:
   * a camera looking DOWN at the target prefers ABOVE (closer to
   * the camera); looking UP prefers BELOW. */
  cameraY?: number;
}

export function snapToNearestFace(
  hitWorldPoint: { x: number; y: number; z: number },
  newObject: NewObjectShape,
  nearbyObjects: readonly NearbyObjectInfo[],
  voxelSize: number,
  pullRadiusM: number,
  viewport: SnapViewport = {},
): [number, number, number] | null {
  if (nearbyObjects.length === 0) return null;

  const wouldOverlap = (anchor: [number, number, number]): boolean => {
    const bx = anchor[0] + newObject.width;
    const by = anchor[1] + newObject.height;
    const bz = anchor[2] + newObject.depth;
    for (const obj of nearbyObjects) {
      const o = obj.aabb;
      if (
        bx > o.min[0] + EPS &&
        anchor[0] < o.max[0] - EPS &&
        by > o.min[1] + EPS &&
        anchor[1] < o.max[1] - EPS &&
        bz > o.min[2] + EPS &&
        anchor[2] < o.max[2] - EPS
      ) {
        return true;
      }
    }
    return false;
  };

  let bestVoxel: [number, number, number] | null = null;
  let bestDist = pullRadiusM;

  for (const obj of nearbyObjects) {
    const aabbDist = distanceToAABB(hitWorldPoint, obj.aabb);
    if (aabbDist >= bestDist) continue;

    // Primary: face dictated by the cursor's dominant axis (camera
    // direction breaks Y ties).
    const primaryFace = pickDominantFace(
      hitWorldPoint,
      obj.aabb,
      viewport.cameraY,
    );
    let anchor = computeFlushAnchor(
      primaryFace,
      obj.aabb,
      hitWorldPoint,
      newObject,
    );

    // If the primary face would overlap another object, fall back to
    // stacking above-or-below. Side preference uses the camera angle:
    // looking down → stack above (closer to viewer); looking up →
    // stack below. Without camera info, fall back to the cursor's Y
    // relative to the cube midpoint.
    if (wouldOverlap(anchor)) {
      const cy = (obj.aabb.min[1] + obj.aabb.max[1]) / 2;
      const above =
        viewport.cameraY !== undefined
          ? viewport.cameraY >= cy
          : hitWorldPoint.y >= cy;
      const stackFace: Face = above ? '+y' : '-y';
      if (stackFace === primaryFace) continue;
      anchor = computeFlushAnchor(stackFace, obj.aabb, hitWorldPoint, newObject);
      if (wouldOverlap(anchor)) {
        // Stack target also overlaps — try the other side.
        const flipFace: Face = above ? '-y' : '+y';
        if (flipFace === primaryFace) continue;
        anchor = computeFlushAnchor(flipFace, obj.aabb, hitWorldPoint, newObject);
        if (wouldOverlap(anchor)) continue;
      }
    }

    bestDist = aabbDist;
    bestVoxel = [
      Math.round(anchor[0] / voxelSize),
      Math.round(anchor[1] / voxelSize),
      Math.round(anchor[2] / voxelSize),
    ];
  }

  return bestVoxel;
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
