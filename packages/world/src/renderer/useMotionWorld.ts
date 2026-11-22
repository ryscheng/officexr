import { useMemo } from 'react';
import type { Store, Vec3 } from '@officexr/sdk';
import type { InteractionWorld } from '../input/interaction.ts';
import type { MotionWorld } from '../motion/self-motion.ts';
import { nearestRideStand } from '../motion/ride.ts';
import { nearestWandStand } from '../motion/wand.ts';
import { waterAt } from '../motion/water.ts';
import { useApplication, useCatalog } from '../react/application-context.tsx';
import { useStoreWorldObjects } from './useStoreWorldObjects.ts';
import { useWaterVolumes } from './useWaterVolumes.ts';

export type SelfWorld = MotionWorld & InteractionWorld;

export function useMotionWorld(store: Store): SelfWorld {
  const { geometry, catalog } = useApplication();
  const volumes = useWaterVolumes(store);
  const worldObjects = useStoreWorldObjects(store);
  const kinds = useCatalog();
  return useMemo<SelfWorld>(
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
      wandStandNear: (feet) => {
        const { players } = store.getState();
        const taken = new Set(Object.values(players).flatMap((p) => (p.heldStand ? [p.heldStand] : [])));
        return nearestWandStand(worldObjects.instances, catalog, geometry, feet, undefined, taken)?.id ?? null;
      },
      anchorOf: (instanceId) => {
        const instance = worldObjects.instances.find((i) => i.id === instanceId);
        if (!instance) {
          return null;
        }
        const { min, max } = geometry.worldAABBOfInstance(instance);
        return { x: (min[0] + max[0]) / 2, y: max[1], z: (min[2] + max[2]) / 2 };
      },
    }),
    [volumes, worldObjects, kinds, catalog, geometry, store],
  );
}
