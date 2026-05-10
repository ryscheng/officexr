import type { WorldMap } from '../game-state/types.ts';
import { groupConnectedCubes } from './flood-fill.ts';
import type { CollisionWorld } from './types.ts';

/** WeakMap so a stale cache entry can't keep an old WorldMap alive after
 * the store swaps in a new one. Keyed by reference identity — the store
 * always hands out fresh objects via `setWorldMap` / `applyRemoteWorldMap`. */
const cache = new WeakMap<WorldMap, CollisionWorld>();

/**
 * Returns the spatial-partitioned, flood-filled obstacle world for `map`.
 * Reference-cached: same `WorldMap` ⇒ same `CollisionWorld`. Callers in
 * the per-frame loop should pass the same `state.worldMap` they read from
 * the store; a new map (from any setter) invalidates automatically.
 */
export function getCollisionWorld(map: WorldMap): CollisionWorld {
  let world = cache.get(map);
  if (world) return world;
  world = buildCollisionWorld(map);
  cache.set(map, world);
  return world;
}

export function buildCollisionWorld(map: WorldMap): CollisionWorld {
  const { cells, groups } = groupConnectedCubes(map);
  return {
    gridSize: map.gridSize,
    cubeSize: map.cubeSize,
    origin: { ...map.origin },
    halfExtent: (map.gridSize * map.cubeSize) / 2,
    cells,
    groups,
  };
}
