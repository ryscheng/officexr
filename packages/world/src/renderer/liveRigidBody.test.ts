import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { liveRigidBody } from './liveRigidBody.ts';

beforeAll(async () => {
  await RAPIER.init();
});

describe('liveRigidBody', () => {
  it('passes a body that is still in its world', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    expect(liveRigidBody(body)).toBe(body);
    world.free();
  });

  it('drops a removed body, so the world stays usable', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    world.createCollider(RAPIER.ColliderDesc.ball(0.5), body);
    world.removeRigidBody(body);

    liveRigidBody(body)?.setNextKinematicTranslation({ x: 1, y: 0, z: 0 });

    expect(liveRigidBody(body)).toBeNull();
    expect(() => world.step()).not.toThrow();
    expect(() => world.free()).not.toThrow();
  });

  it('passes null through', () => {
    expect(liveRigidBody(null)).toBeNull();
    expect(liveRigidBody(undefined)).toBeNull();
  });
});
