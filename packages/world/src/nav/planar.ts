export type XZ = { x: number; z: number };

export function planarDistance(a: XZ, b: XZ): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}
