/**
 * air-control.ts — headless in-flight horizontal steering.
 *
 * No Three, no React, no r3f imports; SceneFrame depends on this module.
 */

export type Velocity2 = { x: number; z: number };

/**
 * Next air velocity (m/s) after blending `current` toward the WASD `intent`.
 *
 * `airControl` (0..1) is the fraction of the remaining gap closed per 1/60 s,
 * so the result does not depend on frame rate. 0 keeps `current`; 1 snaps to
 * `intent`; `dtSec` 0 keeps `current`.
 */
export function stepAirVelocity(
  current: Velocity2,
  intent: Velocity2,
  airControl: number,
  dtSec: number,
): Velocity2 {
  const alpha = 1 - (1 - airControl) ** (dtSec * 60);
  return {
    x: current.x + (intent.x - current.x) * alpha,
    z: current.z + (intent.z - current.z) * alpha,
  };
}
