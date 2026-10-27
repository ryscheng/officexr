import { useEffect, useMemo, useState } from 'react';
import type { ObjectInstance, Store, WorldObjects } from '@officexr/sdk';
import type { BakedLayoutPlacement } from '../app/map-loader.ts';
import { layoutIdPrefix } from '../scenes/compile-map.ts';

export type ExcludeInstance = (instance: ObjectInstance) => boolean;

/** Matches the instances `compileMap` compiled from these placements' layouts; undefined when there are none. */
export function excludeLayoutInstances(
  placements: readonly Pick<BakedLayoutPlacement, 'roomInstanceId'>[] | undefined,
): ExcludeInstance | undefined {
  if (!placements?.length) {
    return undefined;
  }
  const prefixes = placements.map((p) => layoutIdPrefix(p.roomInstanceId));
  return (instance) => prefixes.some((prefix) => instance.id.startsWith(prefix));
}

/**
 * Follows `store`'s `worldObjects`, leaving out the instances `exclude` matches.
 * `exclude` must be referentially stable, or the result is a new object every render.
 */
export function useStoreWorldObjects(store: Store, exclude?: ExcludeInstance): WorldObjects {
  const [snapshot, setSnapshot] = useState<WorldObjects>(() => store.getState().worldObjects);
  useEffect(() => {
    // Re-read before subscribing: a `setWorldObjects` landing between the
    // lazy init (during render) and this effect (after commit) would
    // otherwise be missed, pinning the snapshot to the empty default.
    setSnapshot(store.getState().worldObjects);
    return store.subscribe((s) => s.worldObjects, setSnapshot);
  }, [store]);
  return useMemo(
    () => (exclude ? { ...snapshot, instances: snapshot.instances.filter((i) => !exclude(i)) } : snapshot),
    [snapshot, exclude],
  );
}
