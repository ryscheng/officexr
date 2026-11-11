import RAPIER from '@dimforge/rapier3d-compat';
import { describe, expect, it, vi } from 'vitest';
import type { RapierRigidBody } from '@react-three/rapier';
import { createActions, createStore } from '@officexr/sdk';
import { isStandingSpotFree, sitOnPress, stepSeated, type SeatingSource } from './seated.ts';

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

describe('isStandingSpotFree', () => {
  const R = 0.4;
  /** A floor slab whose top sits 0.15 m above y = 0, the way a placed floor tile does. */
  async function worldWithSlab() {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.createCollider(RAPIER.ColliderDesc.cuboid(10, 0.075, 10).setTranslation(0, 0.075, 0));
    return world;
  }

  it('stands the probe on a floor slab that starts above the chair footprint', async () => {
    const world = await worldWithSlab();
    world.step();
    expect(isStandingSpotFree(world, null, R, { x: 0, y: 0, z: 0 })).toBe(true);
  });

  it('still sees an obstacle standing on the slab', async () => {
    const world = await worldWithSlab();
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.3, 0.5, 0.3).setTranslation(0.5, 0.65, 0));
    world.step();
    expect(isStandingSpotFree(world, null, R, { x: 0, y: 0, z: 0 })).toBe(false);
  });
});
