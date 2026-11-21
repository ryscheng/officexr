import type { ObjectInstance } from '@officexr/sdk';

/** How an object reads on the minimap's floor plan. */
export type PlanTone = 'floor' | 'rug' | 'wall' | 'desk' | 'seat' | 'furniture';

/** One object's footprint in world metres (x right, z down the map), with the tone it is filled in. */
export interface PlanRect {
  x: number;
  z: number;
  w: number;
  d: number;
  tone: PlanTone;
}

/** The catalog facts the plan needs; absent when the catalog doesn't know the kind (yet). */
export type PlanKind = { isLayoutObject: boolean; isDesk?: boolean; seats?: unknown } | undefined;

type AABB = { min: readonly number[]; max: readonly number[] };

/** Below this, structure is floor and furniture lies flat (rugs). */
const FLAT_M = 0.3;

/** Walls and floors from layout pieces; desks, seats and the rest from the kind's own flags. */
export function planTone(kind: PlanKind, heightM: number): PlanTone {
  if (kind?.isLayoutObject) {
    return heightM < FLAT_M ? 'floor' : 'wall';
  }
  if (kind?.isDesk) {
    return 'desk';
  }
  if (kind?.seats) {
    return 'seat';
  }
  return heightM < FLAT_M ? 'rug' : 'furniture';
}

/** Back to front: floors, then rugs, then furniture, then walls on top so rooms stay outlined. */
const ORDER: Record<PlanTone, number> = { floor: 0, rug: 1, desk: 2, seat: 2, furniture: 2, wall: 3 };

/** The map's objects as flat footprints, ready to draw in world coordinates. */
export function buildPlan(
  instances: readonly ObjectInstance[],
  aabbOf: (instance: ObjectInstance) => AABB,
  kindOf: (kindId: string) => PlanKind,
): PlanRect[] {
  return instances
    .map((instance) => {
      const { min, max } = aabbOf(instance);
      return {
        x: min[0],
        z: min[2],
        w: max[0] - min[0],
        d: max[2] - min[2],
        tone: planTone(kindOf(instance.kindId), max[1] - min[1]),
      };
    })
    .sort((a, b) => ORDER[a.tone] - ORDER[b.tone]);
}
