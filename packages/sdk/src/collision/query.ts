import type { CollisionWorld, Vec2 } from './types.ts';
import { EMPTY_CELL } from './types.ts';

/**
 * Convert world-space (x, z) to cell-grid coordinates. Out-of-bounds queries
 * return clamped indices — callers should usually validate against
 * {@link CollisionWorld#halfExtent} before invoking this on positions
 * outside the map.
 */
export function cellAt(world: CollisionWorld, x: number, z: number): {
  i: number;
  j: number;
} {
  const half = (world.gridSize - 1) / 2;
  const i = Math.round((x - world.origin.x) / world.cubeSize + half);
  const j = Math.round((z - world.origin.z) / world.cubeSize + half);
  return {
    i: Math.max(0, Math.min(world.gridSize - 1, i)),
    j: Math.max(0, Math.min(world.gridSize - 1, j)),
  };
}

/** World-space centre of cell (i, j). */
export function cellCenter(world: CollisionWorld, i: number, j: number): Vec2 {
  const half = (world.gridSize - 1) / 2;
  return {
    x: world.origin.x + (i - half) * world.cubeSize,
    z: world.origin.z + (j - half) * world.cubeSize,
  };
}

/**
 * Iterate every solid cell whose AABB intersects the circle (x, z, radius).
 * `fn` receives the cell coordinates and the groupId already in the
 * spatial-partition buffer; walkable / empty cells are skipped.
 */
export function forEachCellInRadius(
  world: CollisionWorld,
  x: number,
  z: number,
  radius: number,
  fn: (i: number, j: number, groupId: number) => void,
): void {
  const half = (world.gridSize - 1) / 2;
  // The cells whose centre AABB (±cubeSize/2) might touch the query circle.
  const reach = radius + world.cubeSize / 2;
  const minI = Math.max(
    0,
    Math.floor((x - world.origin.x - reach) / world.cubeSize + half),
  );
  const maxI = Math.min(
    world.gridSize - 1,
    Math.ceil((x - world.origin.x + reach) / world.cubeSize + half),
  );
  const minJ = Math.max(
    0,
    Math.floor((z - world.origin.z - reach) / world.cubeSize + half),
  );
  const maxJ = Math.min(
    world.gridSize - 1,
    Math.ceil((z - world.origin.z + reach) / world.cubeSize + half),
  );
  const r2 = radius * radius;
  const cellHalf = world.cubeSize / 2;
  for (let i = minI; i <= maxI; i++) {
    const cx = world.origin.x + (i - half) * world.cubeSize;
    for (let j = minJ; j <= maxJ; j++) {
      const groupId = world.cells[i * world.gridSize + j];
      if (groupId === EMPTY_CELL) continue;
      const cz = world.origin.z + (j - half) * world.cubeSize;
      // Closest point on this cell's AABB to the query centre.
      const px = clamp(x, cx - cellHalf, cx + cellHalf);
      const pz = clamp(z, cz - cellHalf, cz + cellHalf);
      const dx = x - px;
      const dz = z - pz;
      if (dx * dx + dz * dz > r2) continue;
      fn(i, j, groupId);
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
