import { parseSeatId, type PlayerPose, type Vec3 } from '@officexr/sdk';
import type { MotionWorld } from '../motion/self-motion.ts';
import type { ActionId } from './action-input.ts';

export type InteractionKind = 'sit' | 'stand' | 'ride' | 'dismount' | 'wand-take' | 'wand-return';
export type InteractionKey = 'E' | 'F';

export interface InteractionFacts {
  pose: PlayerPose | null;
  seatedOn: string | null;
  nearbySeatId: string | null;
  feet: Vec3;
  holdingWand: boolean;
}

export interface InteractionWorld extends Pick<MotionWorld, 'rideNear'> {
  wandStandNear(feet: Vec3): string | null;
  anchorOf(instanceId: string): Vec3 | null;
}

export interface InteractionOption {
  kind: InteractionKind;
  label: string;
  /** `action` stands in for `key` when a touch button runs the option. */
  key: InteractionKey;
  action: ActionId;
}

export interface InteractionPrompt {
  options: readonly InteractionOption[];
  anchor: Vec3 | null;
}

export const NO_PROMPT: InteractionPrompt = Object.freeze({ options: Object.freeze([]), anchor: null });

export const MAX_INTERACTION_OPTIONS = 3;

interface Offer {
  label: string;
  instanceId: string | null;
}

interface Provider {
  key: InteractionKey;
  action: ActionId;
  priority: number;
  offer(facts: InteractionFacts, world: InteractionWorld): Offer | null;
}

const onFoot = (f: InteractionFacts) => f.pose === null && f.seatedOn === null;

export const INTERACTION_PROVIDERS: Record<InteractionKind, Provider> = {
  'wand-return': {
    key: 'F',
    action: 'mount',
    priority: 0,
    offer: (f) => (f.holdingWand ? { label: 'Put wand back', instanceId: null } : null),
  },
  dismount: {
    key: 'F',
    action: 'mount',
    priority: 1,
    offer: (f) => (!f.holdingWand && (f.pose === 'scooter' || f.pose === 'tricycle') ? { label: 'Get off', instanceId: null } : null),
  },
  'wand-take': {
    key: 'F',
    action: 'mount',
    priority: 2,
    offer: (f, w) => {
      const standId = !f.holdingWand && onFoot(f) ? w.wandStandNear(f.feet) : null;
      return standId === null ? null : { label: 'Take wand', instanceId: standId };
    },
  },
  ride: {
    key: 'F',
    action: 'mount',
    priority: 3,
    offer: (f, w) => {
      if (f.holdingWand || !onFoot(f) || w.wandStandNear(f.feet) !== null) {
        return null;
      }
      const stand = w.rideNear(f.feet);
      return stand && { label: `Ride ${stand.vehicle}`, instanceId: stand.rackId };
    },
  },
  stand: {
    key: 'E',
    action: 'sit',
    priority: 4,
    offer: (f) => (f.seatedOn === null ? null : { label: 'Stand up', instanceId: parseSeatId(f.seatedOn).instanceId }),
  },
  sit: {
    key: 'E',
    action: 'sit',
    priority: 5,
    offer: (f) => (f.pose === null && f.seatedOn === null && f.nearbySeatId !== null ? { label: 'Sit', instanceId: parseSeatId(f.nearbySeatId).instanceId } : null),
  },
};

const KINDS_BY_PRIORITY = (Object.keys(INTERACTION_PROVIDERS) as InteractionKind[]).sort(
  (a, b) => INTERACTION_PROVIDERS[a].priority - INTERACTION_PROVIDERS[b].priority,
);

export function interactionPrompt(facts: InteractionFacts, world: InteractionWorld): InteractionPrompt {
  const offers: { option: InteractionOption; instanceId: string | null }[] = [];
  for (const kind of KINDS_BY_PRIORITY) {
    const { key, action, offer } = INTERACTION_PROVIDERS[kind];
    const made = offer(facts, world);
    if (made) {
      offers.push({ option: { kind, label: made.label, key, action }, instanceId: made.instanceId });
    }
  }
  const shown = offers.slice(0, MAX_INTERACTION_OPTIONS);
  const first = shown[0];
  if (!first) {
    return NO_PROMPT;
  }
  return {
    options: shown.map((o) => o.option),
    anchor: first.instanceId === null ? null : world.anchorOf(first.instanceId),
  };
}

const samePrompt = (a: InteractionPrompt, b: InteractionPrompt) =>
  a.options.length === b.options.length &&
  a.options.every((o, i) => o.kind === b.options[i]?.kind && o.label === b.options[i]?.label) &&
  a.anchor?.x === b.anchor?.x &&
  a.anchor?.y === b.anchor?.y &&
  a.anchor?.z === b.anchor?.z;

export class InteractionStore {
  private offered: InteractionPrompt = NO_PROMPT;
  private suppressed = false;
  private visible: InteractionPrompt = NO_PROMPT;
  private readonly listeners = new Set<() => void>();

  get = (): InteractionPrompt => this.visible;

  offer(next: InteractionPrompt): void {
    if (!samePrompt(next, this.offered)) {
      this.offered = next;
      this.refresh();
    }
  }

  setSuppressed(suppressed: boolean): void {
    if (suppressed !== this.suppressed) {
      this.suppressed = suppressed;
      this.refresh();
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private refresh(): void {
    const next = this.suppressed ? NO_PROMPT : this.offered;
    if (next !== this.visible) {
      this.visible = next;
      this.listeners.forEach((l) => l());
    }
  }
}
