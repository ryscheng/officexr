import type { ReactNode } from 'react';
import type { ActionInput } from '../input/action-input.ts';
import type { ActionContext } from '../input/action-context.ts';

export interface MobileActionContext extends ActionContext {
  input: ActionInput;
}

export type PerContext<T> = T | ((ctx: MobileActionContext) => T);

/** One round button of the touch action pad. Adding an action is adding one entry and registering it. */
export interface MobileAction {
  id: string;
  /** A key of `PAD_SLOTS`; the slot is fixed so buttons never shift when others hide. */
  slot: number;
  icon: PerContext<ReactNode>;
  label: PerContext<string>;
  /** Shown while this returns true; absent means always. */
  visible?(ctx: MobileActionContext): boolean;
  /** Draws the button lit, for toggles. */
  active?(ctx: MobileActionContext): boolean;
  onPress(ctx: MobileActionContext): void;
  /** Called when the finger lifts or the button disappears while held. */
  onRelease?(ctx: MobileActionContext): void;
}

export interface PadSlot {
  /** Button diameter in px. */
  size: number;
  /** Distance of the button centre from the primary button's centre. */
  radius: number;
  /** Degrees from straight left of the primary button, turning up. */
  angleDeg: number;
}

export const PRIMARY_SIZE = 80;
export const SECONDARY_SIZE = 60;

/** Slot 0 is the big thumb button in the corner; the others fan out left and up from it. */
export const PAD_SLOTS: readonly PadSlot[] = [
  { size: PRIMARY_SIZE, radius: 0, angleDeg: 0 },
  { size: SECONDARY_SIZE, radius: 88, angleDeg: 0 },
  { size: SECONDARY_SIZE, radius: 88, angleDeg: 45 },
  { size: SECONDARY_SIZE, radius: 88, angleDeg: 90 },
  { size: SECONDARY_SIZE, radius: 164, angleDeg: 22 },
  { size: SECONDARY_SIZE, radius: 164, angleDeg: 52 },
  { size: SECONDARY_SIZE, radius: 164, angleDeg: 82 },
];

export const resolve = <T>(value: PerContext<T>, ctx: MobileActionContext): T =>
  typeof value === 'function' ? (value as (c: MobileActionContext) => T)(ctx) : value;

/** The actions to draw: in a known slot, visible now, and one per slot (the later registration wins). */
export function visibleActions(actions: readonly MobileAction[], ctx: MobileActionContext): MobileAction[] {
  const bySlot = new Map<number, MobileAction>();
  for (const action of actions) {
    if (PAD_SLOTS[action.slot] && (action.visible?.(ctx) ?? true)) {
      bySlot.set(action.slot, action);
    }
  }
  return [...bySlot.values()].sort((a, b) => a.slot - b.slot);
}

/** Actions from the world and from overlays (via `useMobileActions`); a later entry with the same id replaces an earlier one. */
export class MobileActionRegistry {
  private groups: (readonly MobileAction[])[] = [];
  private actions: readonly MobileAction[] = [];
  private readonly listeners = new Set<() => void>();

  register(group: readonly MobileAction[]): () => void {
    this.groups = [...this.groups, group];
    this.publish();
    return () => {
      this.groups = this.groups.filter((g) => g !== group);
      this.publish();
    };
  }

  list = (): readonly MobileAction[] => this.actions;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(): void {
    const byId = new Map<string, MobileAction>();
    for (const action of this.groups.flat()) {
      byId.set(action.id, action);
    }
    this.actions = [...byId.values()];
    this.listeners.forEach((l) => l());
  }
}
