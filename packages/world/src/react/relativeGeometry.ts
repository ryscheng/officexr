import type { Vec3 } from '@officexr/sdk';
import { wrapAngle, yawFromDirection } from '../renderer/lookControls.ts';

export function planarDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

/**
 * Where `targetPos` appears relative to the view, in radians in (-π, π]:
 * 0 is straight ahead, positive is to the right (clockwise from above).
 * `viewYaw` is a yaw as `yawFromDirection` returns it (0 faces -z, positive
 * turns counter-clockwise). Coincident points have no bearing and give 0.
 */
export function relativeBearing(selfPos: Vec3, viewYaw: number, targetPos: Vec3): number {
  const dx = targetPos.x - selfPos.x;
  const dz = targetPos.z - selfPos.z;
  if (dx === 0 && dz === 0) {
    return 0;
  }
  return wrapAngle(viewYaw - yawFromDirection({ x: dx, z: dz }));
}
