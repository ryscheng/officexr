import type { Vec3 } from '@officexr/sdk';
import { planarDistance, relativeBearing, type NavGrid } from '@officexr/world/react';

/**
 * Where `point` lands on a `sizePx` square map spanning `rangeM` metres, centred
 * on `selfPos` and turned so `viewYaw` points up. Points beyond `rangeM / 2` are
 * pinned to the rim in their direction.
 */
export function toMinimap(
  selfPos: Vec3,
  viewYaw: number,
  point: Vec3,
  { rangeM, sizePx }: { rangeM: number; sizePx: number },
): { x: number; y: number; clamped: boolean } {
  const bearing = relativeBearing(selfPos, viewYaw, point);
  const distance = planarDistance(selfPos, point);
  const clamped = distance > rangeM / 2;
  const r = ((clamped ? rangeM / 2 : distance) * sizePx) / rangeM;
  return { x: sizePx / 2 + r * Math.sin(bearing), y: sizePx / 2 - r * Math.cos(bearing), clamped };
}

const paths = new WeakMap<NavGrid, string>();

type Run = { i0: number; i1: number; fromRow: number };

/**
 * The walkable cells of `grid` as one SVG path in cell units (x along i, y along j):
 * each row's runs, merged downwards while the rows below repeat them.
 */
export function navGridPath(grid: NavGrid): string {
  const cached = paths.get(grid);
  if (cached !== undefined) {
    return cached;
  }
  const rects: string[] = [];
  const close = ({ i0, i1, fromRow }: Run, toRow: number) => {
    rects.push(`M${i0} ${fromRow}h${i1 - i0}v${toRow - fromRow}h${i0 - i1}z`);
  };
  let open = new Map<string, Run>();
  for (let j = 0; j < grid.height; j++) {
    const walkable = (i: number) => grid.walkable[j * grid.width + i];
    const next = new Map<string, Run>();
    for (let i = 0; i < grid.width; i++) {
      if (!walkable(i)) {
        continue;
      }
      const i0 = i;
      while (i < grid.width && walkable(i)) {
        i++;
      }
      const key = `${i0},${i}`;
      next.set(key, open.get(key) ?? { i0, i1: i, fromRow: j });
      open.delete(key);
    }
    open.forEach((run) => close(run, j));
    open = next;
  }
  open.forEach((run) => close(run, grid.height));
  const d = rects.join('');
  paths.set(grid, d);
  return d;
}
