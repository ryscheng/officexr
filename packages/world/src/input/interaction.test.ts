import { describe, expect, it, vi } from 'vitest';
import { ActionInput } from './action-input.ts';
import {
  InteractionStore,
  interactionPrompt,
  INTERACTION_PROVIDERS,
  NO_PROMPT,
  type InteractionFacts,
  type InteractionWorld,
} from './interaction.ts';
import { createInteractionSource } from '../react/interactionPrompt.tsx';

const feet = { x: 0, y: 0, z: 0 };
const base: InteractionFacts = { pose: null, seatedOn: null, nearbySeatId: null, feet, holdingWand: false };
const nothing: InteractionWorld = { rideNear: () => null, wandStandNear: () => null, anchorOf: () => null };
const top = { x: 1, y: 1.2, z: 2 };
const world = (over: Partial<InteractionWorld> = {}): InteractionWorld => ({ ...nothing, anchorOf: () => top, ...over });
const kinds = (p: ReturnType<typeof interactionPrompt>) => p.options.map((o) => o.kind);

describe('interactionPrompt', () => {
  it('offers Sit on E next to a free seat, anchored above its chair', () => {
    const anchorOf = vi.fn(() => top);
    const prompt = interactionPrompt({ ...base, nearbySeatId: 'couch@1,0,2#1' }, world({ anchorOf }));
    expect(prompt.options).toEqual([{ kind: 'sit', label: 'Sit', key: 'E', action: 'sit' }]);
    expect(prompt.anchor).toEqual(top);
    expect(anchorOf).toHaveBeenCalledWith('couch@1,0,2');
  });

  it('offers Stand up on E while seated, and no Sit', () => {
    const prompt = interactionPrompt({ ...base, seatedOn: 'chair@1,0,2', nearbySeatId: 'chair@1,0,2' }, world());
    expect(prompt.options.map((o) => [o.kind, o.label, o.key])).toEqual([['stand', 'Stand up', 'E']]);
  });

  it('offers Ride on F next to a rack, with the vehicle named', () => {
    const prompt = interactionPrompt(base, world({ rideNear: () => ({ vehicle: 'scooter', rackId: 'rack' }) }));
    expect(prompt.options.map((o) => [o.kind, o.label, o.key])).toEqual([['ride', 'Ride scooter', 'F']]);
  });

  it('puts the object in reach first and keeps a second action', () => {
    const rack = world({ rideNear: () => ({ vehicle: 'tricycle', rackId: 'rack' }) });
    expect(kinds(interactionPrompt({ ...base, nearbySeatId: 'chair' }, rack))).toEqual(['ride', 'sit']);
  });

  it('offers Take wand, not Ride, when a wand stand is also in reach', () => {
    const both = world({ rideNear: () => ({ vehicle: 'scooter', rackId: 'rack' }), wandStandNear: () => 'stand' });
    expect(kinds(interactionPrompt(base, both))).toEqual(['wand-take']);
  });

  it('offers Put wand back first while holding it', () => {
    expect(kinds(interactionPrompt({ ...base, holdingWand: true, nearbySeatId: 'chair' }, world({ wandStandNear: () => 'stand' })))).toEqual([
      'wand-return',
      'sit',
    ]);
  });

  it('offers Get off with no anchor while riding', () => {
    const prompt = interactionPrompt({ ...base, pose: 'scooter', nearbySeatId: 'chair' }, world());
    expect(kinds(prompt)).toEqual(['dismount']);
    expect(prompt.anchor).toBeNull();
  });

  it('offers nothing out of reach or while swimming', () => {
    expect(interactionPrompt(base, nothing)).toBe(NO_PROMPT);
    expect(interactionPrompt({ ...base, pose: 'swim', nearbySeatId: 'chair' }, world())).toBe(NO_PROMPT);
  });

  it('shows at most three options', () => {
    const count = Object.keys(INTERACTION_PROVIDERS).length;
    const prompt = interactionPrompt(
      { ...base, holdingWand: true, pose: 'scooter', seatedOn: 'a', nearbySeatId: 'b' },
      world({ wandStandNear: () => 's', rideNear: () => ({ vehicle: 'scooter', rackId: 'r' }) }),
    );
    expect(count).toBeGreaterThan(3);
    expect(prompt.options.length).toBeLessThanOrEqual(3);
  });
});

describe('InteractionStore', () => {
  const sit = interactionPrompt({ ...base, nearbySeatId: 'chair' }, world());

  it('notifies only when the prompt changes', () => {
    const store = new InteractionStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.offer(sit);
    store.offer(interactionPrompt({ ...base, nearbySeatId: 'chair' }, world()));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.get()).toBe(sit);
  });

  it('reads as empty while suppressed and returns when released', () => {
    const store = new InteractionStore();
    store.offer(sit);
    store.setSuppressed(true);
    expect(store.get()).toBe(NO_PROMPT);
    store.offer(NO_PROMPT);
    store.setSuppressed(false);
    expect(store.get()).toBe(NO_PROMPT);
    store.offer(sit);
    expect(store.get()).toBe(sit);
  });
});

describe('createInteractionSource', () => {
  it('runs an option as the key it stands in for, read on the next frame', () => {
    const input = new ActionInput();
    const source = createInteractionSource(new InteractionStore(), input);
    source.run('sit');
    expect([...input.mergeInto(new Set())]).toEqual(['e']);
    source.run('ride');
    expect([...input.mergeInto(new Set())]).toEqual(['f']);
    expect([...input.mergeInto(new Set())]).toEqual([]);
  });
});
