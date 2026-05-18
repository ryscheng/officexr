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

export function snapToNearestFace(
  hitWorldPoint: { x: number; y: number; z: number },
  newObject: NewObjectShape,
  nearbyObjects: readonly NearbyObjectInfo[],
  voxelSize: number,
  pullRadiusM: number,
): [number, number, number] | null {
  if (nearbyObjects.length === 0) return null;

  const clamp = (v: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, v));

  let bestVoxel: [number, number, number] | null = null;
  let bestDist = pullRadiusM;

  for (const obj of nearbyObjects) {
    const omin = obj.aabb.min;
    const omax = obj.aabb.max;

    // Six candidate faces. For each, compute:
    //   - the cursor's distance to the FACE RECTANGLE (not just the
    //     face plane) so a cursor far above the cube doesn't snap to
    //     the cube's bottom face just because their Y values happen
    //     to coincide.
    //   - the new object's voxel anchor that puts it flush against
    //     this face. Y-axis anchors keep the cursor's Y when sliding
    //     along a vertical face so the new object sits at the
    //     cursor's height.
    const candidates: Array<{
      anchor: [number, number, number];
      cursorDist: number;
    }> = [];

    // +X face: plane x = omax.x, rect over y ∈ [omin.y, omax.y], z ∈ [omin.z, omax.z]
    {
      const cy = clamp(hitWorldPoint.y, omin[1], omax[1]);
      const cz = clamp(hitWorldPoint.z, omin[2], omax[2]);
      const d = Math.hypot(
        hitWorldPoint.x - omax[0],
        hitWorldPoint.y - cy,
        hitWorldPoint.z - cz,
      );
      candidates.push({
        anchor: [
          omax[0],
          // Sit at the cursor's height, but never below the existing
          // object's base, so a click on the cube top stays on top.
          Math.max(hitWorldPoint.y, omin[1]),
          hitWorldPoint.z - newObject.depth / 2,
        ],
        cursorDist: d,
      });
    }
    // -X face: plane x = omin.x
    {
      const cy = clamp(hitWorldPoint.y, omin[1], omax[1]);
      const cz = clamp(hitWorldPoint.z, omin[2], omax[2]);
      const d = Math.hypot(
        hitWorldPoint.x - omin[0],
        hitWorldPoint.y - cy,
        hitWorldPoint.z - cz,
      );
      candidates.push({
        anchor: [
          omin[0] - newObject.width,
          Math.max(hitWorldPoint.y, omin[1]),
          hitWorldPoint.z - newObject.depth / 2,
        ],
        cursorDist: d,
      });
    }
    // +Y face (top): plane y = omax.y, rect over x ∈ [omin.x, omax.x], z ∈ [omin.z, omax.z]
    {
      const cx = clamp(hitWorldPoint.x, omin[0], omax[0]);
      const cz = clamp(hitWorldPoint.z, omin[2], omax[2]);
      const d = Math.hypot(
        hitWorldPoint.x - cx,
        hitWorldPoint.y - omax[1],
        hitWorldPoint.z - cz,
      );
      candidates.push({
        anchor: [
          hitWorldPoint.x - newObject.width / 2,
          omax[1],
          hitWorldPoint.z - newObject.depth / 2,
        ],
        cursorDist: d,
      });
    }
    // -Y face (bottom): plane y = omin.y. Skip — placing below an
    // existing object's bottom is a rare gesture and shouldn't pull
    // when the cursor is at floor level next to the cube.
    // +Z face: plane z = omax.z
    {
      const cx = clamp(hitWorldPoint.x, omin[0], omax[0]);
      const cy = clamp(hitWorldPoint.y, omin[1], omax[1]);
      const d = Math.hypot(
        hitWorldPoint.x - cx,
        hitWorldPoint.y - cy,
        hitWorldPoint.z - omax[2],
      );
      candidates.push({
        anchor: [
          hitWorldPoint.x - newObject.width / 2,
          Math.max(hitWorldPoint.y, omin[1]),
          omax[2],
        ],
        cursorDist: d,
      });
    }
    // -Z face: plane z = omin.z
    {
      const cx = clamp(hitWorldPoint.x, omin[0], omax[0]);
      const cy = clamp(hitWorldPoint.y, omin[1], omax[1]);
      const d = Math.hypot(
        hitWorldPoint.x - cx,
        hitWorldPoint.y - cy,
        hitWorldPoint.z - omin[2],
      );
      candidates.push({
        anchor: [
          hitWorldPoint.x - newObject.width / 2,
          Math.max(hitWorldPoint.y, omin[1]),
          omin[2] - newObject.depth,
        ],
        cursorDist: d,
      });
    }

    for (const c of candidates) {
      if (c.cursorDist >= bestDist) continue;
      // Quantize anchor → voxel position. NO step rounding — the
      // flush position is the snap target. Step rounding would push
      // the new object off the flush plane, defeating the whole
      // point of the snap. For floor-grid snaps (no nearby object)
      // we DO use step rounding; that happens in snapToVoxel.
      bestDist = c.cursorDist;
      bestVoxel = [
        Math.round(c.anchor[0] / voxelSize),
        Math.round(c.anchor[1] / voxelSize),
        Math.round(c.anchor[2] / voxelSize),
      ];
    }
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
