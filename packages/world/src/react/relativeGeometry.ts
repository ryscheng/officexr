import type { Vec3 } from '@officexr/sdk';
import { yawFromDirection } from '../renderer/lookControls.ts';

/** Wraps an angle in radians into (-π, π]. */
export function wrapAngle(rad: number): number {
  const a = rad % (2 * Math.PI);
  return a <= -Math.PI ? a + 2 * Math.PI : a > Math.PI ? a - 2 * Math.PI : a;
}

/** Metres between two points on the ground plane; `y` changes on stairs, so it is ignored. */
export function planarDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

/**
 * Where `targetPos` appears relative to the view, in radians in (-π, π]:
 * 0 is straight ahead, positive is to the right (clockwise from above).
 * `viewYaw` uses the `yawRef` convention.
 */
export function relativeBearing(selfPos: Vec3, viewYaw: number, targetPos: Vec3): number {
  const targetYaw = yawFromDirection({ x: targetPos.x - selfPos.x, z: targetPos.z - selfPos.z });
  return wrapAngle(viewYaw - targetYaw);
}
