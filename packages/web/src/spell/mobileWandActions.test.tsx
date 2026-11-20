import { describe, expect, it, vi } from 'vitest';
import { ActionInput, ACTION_KEYS, PAD_SLOTS, visibleActions } from '@officexr/world/react';
import { wandMobileActions, type WandPadState } from './mobileWandActions';

const handlers = () => ({ cycleSpell: vi.fn(), toggleBuild: vi.fn(), place: vi.fn() });
const visible = (state: WandPadState, h = handlers()) =>
  visibleActions(wandMobileActions(state, h), { interact: null, input: new ActionInput() }).map((a) => a.id);

describe('wandMobileActions', () => {
  it('shows only Build with empty hands', () => {
    expect(visible({ holdingWand: false, spell: 'fireball', buildOpen: false })).toEqual(['build']);
  });

  it('shows Cast and the spell cycle while holding the wand', () => {
    expect(visible({ holdingWand: true, spell: 'fireball', buildOpen: false })).toEqual(['cast', 'spell-cycle', 'build']);
  });

  it('swaps the spell cycle for Place while building', () => {
    expect(visible({ holdingWand: true, spell: 'fireball', buildOpen: true })).toEqual(['cast', 'place', 'build']);
  });

  it('puts every action in a slot the pad has, and Cast in slot 6', () => {
    const all = wandMobileActions({ holdingWand: true, spell: 'shrink', buildOpen: true }, handlers());
    for (const a of all) expect(PAD_SLOTS[a.slot]).toBeDefined();
    expect(all.find((a) => a.id === 'cast')?.slot).toBe(6);
  });

  it('Cast presses the key Q stands for, held and released like the key', () => {
    const cast = wandMobileActions({ holdingWand: true, spell: 'fireball', buildOpen: false }, handlers()).find((a) => a.id === 'cast')!;
    const ctx = { interact: null, input: new ActionInput() };
    cast.onPress(ctx);
    expect(ctx.input.isDown('cast')).toBe(true);
    expect(ACTION_KEYS.cast).toBe('q');
    cast.onRelease?.(ctx);
    expect(ctx.input.isDown('cast')).toBe(false);
  });

  it('runs the cycle, build and place handlers and names the spell', () => {
    const h = handlers();
    const all = wandMobileActions({ holdingWand: true, spell: 'levitate', buildOpen: false }, h);
    const ctx = { interact: null, input: new ActionInput() };
    for (const id of ['spell-cycle', 'build', 'place']) all.find((a) => a.id === id)!.onPress(ctx);
    expect(h.cycleSpell).toHaveBeenCalledTimes(1);
    expect(h.toggleBuild).toHaveBeenCalledTimes(1);
    expect(h.place).toHaveBeenCalledTimes(1);
    expect(all.find((a) => a.id === 'spell-cycle')?.label).toBe('Spell: Levitate');
  });
});
