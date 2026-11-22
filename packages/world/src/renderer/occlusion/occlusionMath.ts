export const FADED_OPACITY = 0.28;
export const FADE_SECONDS = 0.15;
export const FLOOR_LIKE_HEIGHT = 0.35;
const BOX_GROW = 0.01;

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

// A viewer inside the box counts as blocked (entry 0); a target inside it does not.
export function segmentBoxEntry(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  minX: number, minY: number, minZ: number,
  maxX: number, maxY: number, maxZ: number,
): number {
  const x0 = minX - BOX_GROW;
  const y0 = minY - BOX_GROW;
  const z0 = minZ - BOX_GROW;
  const x1 = maxX + BOX_GROW;
  const y1 = maxY + BOX_GROW;
  const z1 = maxZ + BOX_GROW;
  if (inside(ax, ay, az, x0, y0, z0, x1, y1, z1)) return 0;
  if (inside(bx, by, bz, x0, y0, z0, x1, y1, z1)) return -1;
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

export function fadeTarget(faded: boolean, cut: boolean): number {
  if (cut) return 0;
  return faded ? FADED_OPACITY : 1;
}

export function stepToward(current: number, target: number, dtSec: number): number {
  const rate = (1 - FADED_OPACITY) / FADE_SECONDS;
  const step = rate * dtSec;
  if (current < target) return Math.min(target, current + step);
  return Math.max(target, current - step);
}

export function stepFade(current: number, faded: boolean, dtSec: number): number {
  return stepToward(current, fadeTarget(faded, false), dtSec);
}

export const ANCHOR_MARGIN = 0.15;
export const ANCHOR_MAX_RADIUS = 5;

export interface Anchor {
  active: boolean;
  x: number;
  y: number;
  z: number;
}

export function createAnchor(): Anchor {
  return { active: false, x: 0, y: 0, z: 0 };
}

export function setAnchorAt(anchor: Anchor, x: number, y: number, z: number): void {
  anchor.active = true;
  anchor.x = x;
  anchor.y = y;
  anchor.z = z;
}
