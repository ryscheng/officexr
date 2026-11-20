import { describe, expect, it, vi } from 'vitest';
import { ActionContextStore, interactKind, type InteractFacts } from './action-context.ts';

const feet = { x: 0, y: 0, z: 0 };
const base: InteractFacts = { pose: null, seated: false, nearbySeat: false, feet };
const nearRack = { rideNear: () => ({ vehicle: 'scooter' as const, rackId: 'r1' }) };
const noRack = { rideNear: () => null };

describe('interactKind', () => {
  it('offers Ride next to a free rack', () => {
    expect(interactKind(base, nearRack)).toBe('ride');
  });

  it('offers Get off while riding, even away from a rack', () => {
    expect(interactKind({ ...base, pose: 'scooter' }, noRack)).toBe('dismount');
    expect(interactKind({ ...base, pose: 'tricycle' }, nearRack)).toBe('dismount');
  });

  it('offers nothing while swimming or seated', () => {
    expect(interactKind({ ...base, pose: 'swim' }, nearRack)).toBeNull();
    expect(interactKind({ ...base, seated: true, nearbySeat: true }, nearRack)).toBeNull();
  });

  it('offers Sit next to a seat when no rack is near, and Ride wins over Sit', () => {
    expect(interactKind({ ...base, nearbySeat: true }, noRack)).toBe('sit');
    expect(interactKind({ ...base, nearbySeat: true }, nearRack)).toBe('ride');
  });

  it('offers nothing when nothing is near', () => {
    expect(interactKind(base, noRack)).toBeNull();
  });
});

describe('ActionContextStore', () => {
  it('notifies only when the context changes', () => {
    const store = new ActionContextStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.set({ interact: null });
    expect(listener).not.toHaveBeenCalled();
    store.set({ interact: 'ride' });
    store.set({ interact: 'ride' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.get().interact).toBe('ride');
  });
});

describe('interactKind with the wand', () => {
  const nearStand = { ...noRack, wandStandNear: () => 's1' };

  it('offers Take wand next to a free stand, ahead of a rack, and not while riding or seated', () => {
    expect(interactKind(base, nearStand)).toBe('wand-take');
    expect(interactKind(base, { ...nearRack, wandStandNear: () => 's1' })).toBe('wand-take');
    expect(interactKind({ ...base, pose: 'scooter' }, nearStand)).toBe('dismount');
    expect(interactKind({ ...base, pose: 'swim' }, nearStand)).toBeNull();
    expect(interactKind({ ...base, seated: true }, nearStand)).toBeNull();
  });

  it('offers Put wand back anywhere while holding it, ahead of ride and sit', () => {
    expect(interactKind({ ...base, holdingWand: true }, noRack)).toBe('wand-return');
    expect(interactKind({ ...base, holdingWand: true, nearbySeat: true }, nearRack)).toBe('wand-return');
  });

  it('rides as before when no stand is near', () => {
    expect(interactKind(base, { ...nearRack, wandStandNear: () => null })).toBe('ride');
  });
});
