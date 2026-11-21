export const FADED_OPACITY = 0.28;
export const FADE_SECONDS = 0.15;
export const FLOOR_LIKE_HEIGHT = 0.35;
export const PULL_IN_MARGIN = 0.3;
export const PULL_IN_MIN_DISTANCE = 0.9;
const PULL_IN_RATE = 28;
const PULL_OUT_RATE = 5;
const BOX_SHRINK = 0.02;

const clip = new Float64Array(2);

function clipAxis(a: number, d: number, min: number, max: number): boolean {
  if (Math.abs(d) < 1e-9) return a > min && a < max;
  let t0 = (min - a) / d;
  let t1 = (max - a) / d;
  if (t0 > t1) {
    const swap = t0;
    t0 = t1;
    t1 = swap;
  }
  if (t0 > clip[0]) clip[0] = t0;
  if (t1 < clip[1]) clip[1] = t1;
  return clip[0] <= clip[1];
}

function inside(
  x: number, y: number, z: number,
  minX: number, minY: number, minZ: number,
  maxX: number, maxY: number, maxZ: number,
): boolean {
  return x > minX && x < maxX && y > minY && y < maxY && z > minZ && z < maxZ;
}

/**
 * Fraction along a->b where the segment enters the box, or -1. A segment that
 * starts inside the box never counts (the viewer is embedded in it). One that
 * ends inside counts only when `endInsideCounts`.
 */
export function segmentBoxEntry(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  minX: number, minY: number, minZ: number,
  maxX: number, maxY: number, maxZ: number,
  endInsideCounts: boolean,
): number {
  const x0 = minX + BOX_SHRINK;
  const y0 = minY + BOX_SHRINK;
  const z0 = minZ + BOX_SHRINK;
  const x1 = maxX - BOX_SHRINK;
  const y1 = maxY - BOX_SHRINK;
  const z1 = maxZ - BOX_SHRINK;
  if (inside(ax, ay, az, x0, y0, z0, x1, y1, z1)) return -1;
  if (!endInsideCounts && inside(bx, by, bz, x0, y0, z0, x1, y1, z1)) return -1;
  clip[0] = 0;
  clip[1] = 1;
  if (!clipAxis(ax, bx - ax, x0, x1)) return -1;
  if (!clipAxis(ay, by - ay, y0, y1)) return -1;
  if (!clipAxis(az, bz - az, z0, z1)) return -1;
  return clip[0];
}

export function isFloorLike(heightM: number): boolean {
  return heightM < FLOOR_LIKE_HEIGHT;
}

/** Moves a fade value (1 = opaque) toward its target at a fixed rate. */
export function stepFade(current: number, faded: boolean, dtSec: number): number {
  const rate = (1 - FADED_OPACITY) / FADE_SECONDS;
  const target = faded ? FADED_OPACITY : 1;
  const step = rate * dtSec;
  if (current < target) return Math.min(target, current + step);
  return Math.max(target, current - step);
}

/** Camera distance from the player that keeps the camera just in front of the first hit. */
export function pulledInDistance(desired: number, hitFraction: number): number {
  if (hitFraction < 0) return desired;
  const wanted = hitFraction * desired - PULL_IN_MARGIN;
  return Math.min(desired, Math.max(Math.min(PULL_IN_MIN_DISTANCE, desired), wanted));
}

/** Eases the camera distance: fast when moving in, slow when easing back out. */
export function easedDistance(current: number, target: number, dtSec: number): number {
  const rate = target < current ? PULL_IN_RATE : PULL_OUT_RATE;
  const next = current + (target - current) * (1 - Math.exp(-rate * dtSec));
  return Math.abs(target - next) < 1e-3 ? target : next;
}
