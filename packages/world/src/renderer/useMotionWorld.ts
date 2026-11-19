import { useMemo } from 'react';
import type { Store } from '@officexr/sdk';
import type { MotionWorld } from '../motion/self-motion.ts';
import { nearestRideStand } from '../motion/ride.ts';
import { waterAt } from '../motion/water.ts';
import { useApplication, useCatalog } from '../react/application-context.tsx';
import { useStoreWorldObjects } from './useStoreWorldObjects.ts';
import { useWaterVolumes } from './useWaterVolumes.ts';

export function useMotionWorld(store: Store): MotionWorld {
  const { geometry, catalog } = useApplication();
  const volumes = useWaterVolumes(store);
  const worldObjects = useStoreWorldObjects(store);
  const kinds = useCatalog();
  return useMemo<MotionWorld>(
    () => ({
      waterAt: (x, z) => waterAt(volumes, x, z),
      rideNear: (feet) => {
        const { players, selfId } = store.getState();
        const taken = new Set(
          Object.values(players).flatMap((p) => (p.id !== selfId && p.poseRack ? [p.poseRack] : [])),
        );
        const stand = nearestRideStand(worldObjects.instances, catalog, geometry, feet, undefined, taken);
        return stand && { vehicle: stand.vehicle, rackId: stand.instance.id };
      },
    }),
    [volumes, worldObjects, kinds, catalog, geometry, store],
  );
}
