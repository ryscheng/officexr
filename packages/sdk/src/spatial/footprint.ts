export interface FootprintRect {
  min: { x: number; z: number };
  max: { x: number; z: number };
}

const clampToRect = (r: FootprintRect, p: { x: number; z: number }) => ({
  x: Math.min(Math.max(p.x, r.min.x), r.max.x),
  z: Math.min(Math.max(p.z, r.min.z), r.max.z),
});

export function isInsideFootprint(rects: readonly FootprintRect[], x: number, z: number): boolean {
  return rects.some((r) => x >= r.min.x && x <= r.max.x && z >= r.min.z && z <= r.max.z);
}

/** `p` if inside any rect, else the nearest point inside any rect; `p` unchanged when `rects` is empty. */
export function clampToFootprint(
  rects: readonly FootprintRect[],
  p: { x: number; z: number },
): { x: number; z: number } {
  if (rects.length === 0 || isInsideFootprint(rects, p.x, p.z)) {
    return p;
  }
  let best = p;
  let bestD = Infinity;
  for (const r of rects) {
    const c = clampToRect(r, p);
    const d = (c.x - p.x) ** 2 + (c.z - p.z) ** 2;
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}
