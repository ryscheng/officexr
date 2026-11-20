import { DEFAULT_SPELL, SPELL_COOLDOWN_MS, type SpellId } from '@officexr/sdk';

export interface ItemsState {
  spell: SpellId;
  lastCastAt: number;
}

export const newItemsState = (): ItemsState => ({ spell: DEFAULT_SPELL, lastCastAt: -Infinity });

export interface ItemsInput {
  now: number;
  fPressed: boolean;
  castPressed: boolean;
  digitSpell: SpellId | null;
  holding: boolean;
  posed: boolean;
  seated: boolean;
  standNear: string | null;
}

export type ItemsAction = { kind: 'pickup'; standId: string } | { kind: 'putback' } | { kind: 'cast'; spell: SpellId } | null;

export interface ItemsOutcome {
  action: ItemsAction;
  /** F went to the wand, so it must not also mount a ride. */
  suppressMount: boolean;
  /** Q went to the wand, so it must not also poke. */
  suppressPoke: boolean;
}

export function stepSelfItems(state: ItemsState, input: ItemsInput): ItemsOutcome {
  if (input.holding && input.digitSpell) {
    state.spell = input.digitSpell;
  }
  const suppressPoke = input.holding;
  if (input.fPressed && input.holding) {
    return { action: { kind: 'putback' }, suppressMount: true, suppressPoke };
  }
  if (input.fPressed && !input.holding && !input.posed && !input.seated && input.standNear) {
    return { action: { kind: 'pickup', standId: input.standNear }, suppressMount: true, suppressPoke };
  }
  const canCast = input.holding && !input.seated && !input.posed && input.now - state.lastCastAt >= SPELL_COOLDOWN_MS;
  if (input.castPressed && canCast) {
    state.lastCastAt = input.now;
    return { action: { kind: 'cast', spell: state.spell }, suppressMount: input.holding, suppressPoke };
  }
  return { action: null, suppressMount: input.holding, suppressPoke };
}
