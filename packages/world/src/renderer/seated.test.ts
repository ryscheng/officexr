import { describe, expect, it, vi } from 'vitest';
import type { RapierRigidBody } from '@react-three/rapier';
import { createActions, createStore } from '@officexr/sdk';
import { sitOnPress, stepSeated, type SeatingSource } from './seated.ts';

function fakeSeating(onStand: () => void = () => {}) {
  return { sit: vi.fn(), stand: vi.fn(onStand), setStandingCheck: vi.fn() } satisfies SeatingSource;
}

describe('sitOnPress', () => {
  it('sits only on the frame E goes down', () => {
    const seating = fakeSeating();
    const keys = new Set(['e']);
    expect(sitOnPress(keys, false, seating)).toBe(true);
    expect(sitOnPress(keys, true, seating)).toBe(true);
    expect(sitOnPress(new Set(), true, seating)).toBe(false);
    expect(seating.sit).toHaveBeenCalledTimes(1);
  });
});

describe('stepSeated', () => {
  function setup() {
    const store = createStore({ selfId: 'me', officeId: 'o' });
    const actions = createActions(store);
    actions.upsertPlayer({ id: 'me', pos: { x: 1, y: 2, z: 3 } });
    const body = { setNextKinematicTranslation: vi.fn() };
    return { store, actions, body, asBody: body as unknown as RapierRigidBody };
  }

  it('pins the body to the seated position while the player stays put', () => {
    const { store, body, asBody } = setup();
    const seating = fakeSeating();
    stepSeated(store, 'me', asBody, seating, false);
    expect(seating.stand).not.toHaveBeenCalled();
    expect(body.setNextKinematicTranslation).toHaveBeenCalledWith({ x: 1, y: 2, z: 3 });
  });

  it('stands up on movement and moves the body to where standing put the player', () => {
    const { store, actions, body, asBody } = setup();
    const seating = fakeSeating(() => actions.setSelfPosition({ x: 5, y: 0, z: 6 }, { x: 0, y: 0, z: 0 }, 0, false));
    stepSeated(store, 'me', asBody, seating, true);
    expect(seating.stand).toHaveBeenCalledTimes(1);
    expect(body.setNextKinematicTranslation).toHaveBeenCalledWith({ x: 5, y: 0, z: 6 });
  });
});
