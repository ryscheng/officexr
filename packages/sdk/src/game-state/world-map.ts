import type { WorldMap } from './types.ts';

/**
 * Deep-clone a WorldMap so callers/peers share no mutable references with
 * the store (the collision-world cache keys on map identity, so an in-place
 * mutation would silently keep stale derived data).
 */
export function cloneWorldMap(m: WorldMap): WorldMap {
  return {
    gridSize: m.gridSize,
    cubeSize: m.cubeSize,
    origin: { ...m.origin },
    layers: m.layers.map((l) => ({
      kind: l.kind,
      cells: l.cells.map((c) => ({ i: c.i, j: c.j })),
    })),
    kinds: Object.fromEntries(
      Object.entries(m.kinds).map(([id, k]) => [id, { ...k }]),
    ),
  };
}
