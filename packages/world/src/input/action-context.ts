import type { PlayerPose, Vec3 } from '@officexr/sdk';
import type { MotionWorld } from '../motion/self-motion.ts';

/** What the Interact button would do right now. Add a kind here for a new world interaction. */
export type InteractKind = 'ride' | 'dismount' | 'sit' | 'wand-take' | 'wand-return';

export interface ActionContext {
  interact: InteractKind | null;
}

export const NO_ACTION_CONTEXT: ActionContext = Object.freeze({ interact: null });

export interface InteractFacts {
  pose: PlayerPose | null;
  seated: boolean;
  nearbySeat: boolean;
  feet: Vec3;
  holdingWand?: boolean;
}

/** Mirrors what F (wand, ride) and E (sit) would do this frame. */
export function interactKind(
  facts: InteractFacts,
  world: Pick<MotionWorld, 'rideNear'> & { wandStandNear?(feet: Vec3): string | null },
): InteractKind | null {
  if (facts.holdingWand) {
    return 'wand-return';
  }
  if (facts.seated) {
    return null;
  }
  if (facts.pose === 'scooter' || facts.pose === 'tricycle') {
    return 'dismount';
  }
  if (facts.pose === null && world.wandStandNear?.(facts.feet)) {
    return 'wand-take';
  }
  if (facts.pose === null && world.rideNear(facts.feet)) {
    return 'ride';
  }
  return facts.nearbySeat ? 'sit' : null;
}

/** A small observable holding the context; `set` notifies only when something changed. */
export class ActionContextStore {
  private value: ActionContext = NO_ACTION_CONTEXT;
  private readonly listeners = new Set<() => void>();

  get = (): ActionContext => this.value;

  set(next: ActionContext): void {
    if (next.interact === this.value.interact) {
      return;
    }
    this.value = next;
    this.listeners.forEach((l) => l());
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}
