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
