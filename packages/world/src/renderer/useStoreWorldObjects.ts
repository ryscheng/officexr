import { useEffect, useMemo, useState } from 'react';
import type { ObjectInstance, Store, WorldObjects } from '@officexr/sdk';

export type ExcludeInstance = (instance: ObjectInstance) => boolean;

/** Follows `store`'s `worldObjects`, leaving out the instances `exclude` matches. */
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
