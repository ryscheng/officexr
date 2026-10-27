import { describe, expect, it } from 'vitest';
import type { WorldObjects } from '@officexr/sdk';
import { createInstanceGeometry } from '../app/geometry-service.ts';
import type { WorldObjectKind } from '../scenes/world-object-kinds-schema.ts';
import { BotPhysicsWorld } from './BotPhysicsWorld.ts';

describe('BotPhysicsWorld.syncCubes', () => {
  it('rebuilds colliders after a yaw-only change', () => {
    // A 2 m × 0.5 m wall at the origin: x 0..2, z 0..0.5 unrotated;
    // x 0.75..1.25, z -0.75..1.25 at yaw 90.
    const wall = { id: 'wall', dimensions: { width: 2, height: 1, depth: 0.5 } } as WorldObjectKind;
    const geometry = createInstanceGeometry({
      catalog: { getKind: (id) => (id === 'wall' ? wall : undefined) },
      voxelSize: 0.5,
    });
    const physics = new BotPhysicsWorld({
      selfId: 'bot',
      startPos: { x: 50, y: 10, z: 50 },
      worldSettings: { charRadius: 0.35, proximityRadius: 1, proximityOuterRadius: 2 },
      instanceAABB: geometry.worldAABB,
    });
    const objects = (yawDeg: number): WorldObjects => ({
      cubeSize: 0.5,
      instances: [{ id: 'w', sourceCommandId: 'w', kindId: 'wall', position: [0, 0, 0], yawDeg }],
    });
    const wallBelow = () => {
      physics.stepWorld();
      return physics.probeFloor({ x: 1, y: 2, z: 1 }, 5);
    };

    physics.syncCubes(objects(0));
    expect(wallBelow()).toBe(false);

    physics.syncCubes(objects(90));
    expect(wallBelow()).toBe(true);
  });
});
