import { useMemo } from 'react';
import type { Store } from '@officexr/sdk';
import { waterVolumes, type WaterVolume } from '../motion/water.ts';
import { useApplication, useCatalog } from '../react/application-context.tsx';
import { useStoreWorldObjects } from './useStoreWorldObjects.ts';

/** The swimmable water of every pool placed in `store`'s world; stable until a pool or the catalog changes. */
export function useWaterVolumes(store: Store): WaterVolume[] {
  const { geometry, catalog } = useApplication();
  const worldObjects = useStoreWorldObjects(store);
  const kinds = useCatalog();
  return useMemo(
    () => waterVolumes(worldObjects.instances, catalog, geometry),
    [worldObjects, kinds, catalog, geometry],
  );
}
