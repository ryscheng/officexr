import type { ObjectInstance, Vec3, WorldObjects } from '@officexr/sdk';
import type { KindResolver } from '../app/geometry-service.ts';
import type { InstanceGeometryService } from '../app/types.ts';

export const WAND_REACH_M = 1.3;
const NO_STANDS: ReadonlySet<string> = new Set();

export function nearestWandStand(
  instances: readonly ObjectInstance[],
  catalog: Pick<KindResolver, 'getKind'>,
  geometry: Pick<InstanceGeometryService, 'worldAABBOfInstance'>,
  feet: Vec3,
  reach: number = WAND_REACH_M,
  taken: ReadonlySet<string> = NO_STANDS,
): ObjectInstance | null {
  let best: ObjectInstance | null = null;
  let bestDistance = reach;
  for (const instance of instances) {
    if (!catalog.getKind(instance.kindId)?.holdable || taken.has(instance.id)) {
      continue;
    }
    const { min, max } = geometry.worldAABBOfInstance(instance);
    const distance = Math.hypot(
      Math.max(min[0] - feet.x, 0, feet.x - max[0]),
      Math.max(min[1] - feet.y, 0, feet.y - max[1]),
      Math.max(min[2] - feet.z, 0, feet.z - max[2]),
    );
    if (distance <= bestDistance) {
      best = instance;
      bestDistance = distance;
    }
  }
  return best;
}

/** Stands someone holds the item of, joined with `|` so a selector result compares by value. */
export function heldStands(players: Record<string, { heldStand?: string | null }>): string {
  return Object.values(players)
    .flatMap((p) => (p.heldStand ? [p.heldStand] : []))
    .sort()
    .join('|');
}

/** The objects with each stand in `held` drawn as its empty kind; the same object when none changes. */
export function swapHeldStands(
  worldObjects: WorldObjects,
  catalog: Pick<KindResolver, 'getKind'>,
  held: ReadonlySet<string>,
): WorldObjects {
  if (held.size === 0) {
    return worldObjects;
  }
  let changed = false;
  const instances = worldObjects.instances.map((instance) => {
    const emptyKindId = held.has(instance.id) ? catalog.getKind(instance.kindId)?.holdable?.emptyKindId : undefined;
    if (!emptyKindId) {
      return instance;
    }
    changed = true;
    return { ...instance, kindId: emptyKindId };
  });
  return changed ? { ...worldObjects, instances } : worldObjects;
}
