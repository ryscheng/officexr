import { useMemo } from 'react';
import type { Store } from '@officexr/sdk';
import type { MotionWorld } from '../motion/self-motion.ts';
import { nearestRideStand } from '../motion/ride.ts';
import { waterAt } from '../motion/water.ts';
import { useApplication, useCatalog } from '../react/application-context.tsx';
import { useStoreWorldObjects } from './useStoreWorldObjects.ts';
import { useWaterVolumes } from './useWaterVolumes.ts';

/** What the self player's swim and ride logic reads of the placed objects, rebuilt when they change. */
export function useMotionWorld(store: Store): MotionWorld {
  const { geometry, catalog } = useApplication();
  const volumes = useWaterVolumes(store);
  const worldObjects = useStoreWorldObjects(store);
  const kinds = useCatalog();
  return useMemo<MotionWorld>(
    () => ({
      waterAt: (x, z) => waterAt(volumes, x, z),
      rideNear: (feet) => nearestRideStand(worldObjects.instances, catalog, geometry, feet),
    }),
    [volumes, worldObjects, kinds, catalog, geometry],
  );
}
