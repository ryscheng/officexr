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
  let open = new Map<string, number>();
  const close = (key: string, fromRow: number, toRow: number) => {
    const [i0, i1] = key.split(',').map(Number);
    rects.push(`M${i0} ${fromRow}h${i1 - i0}v${toRow - fromRow}h${i0 - i1}z`);
  };
  for (let j = 0; j <= grid.height; j++) {
    const next = new Map<string, number>();
    for (let i = 0; j < grid.height && i < grid.width; i++) {
      if (!grid.walkable[j * grid.width + i]) {
        continue;
      }
      const i0 = i;
      while (i < grid.width && grid.walkable[j * grid.width + i]) {
        i++;
      }
      const key = `${i0},${i}`;
      next.set(key, open.get(key) ?? j);
      open.delete(key);
    }
    open.forEach((fromRow, key) => close(key, fromRow, j));
    open = next;
  }
  const d = rects.join('');
  paths.set(grid, d);
  return d;
}
