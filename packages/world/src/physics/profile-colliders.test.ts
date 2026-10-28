/**
 * Walk a production bot (BotPhysicsWorld + BotCharacterMovement, the
 * real Rapier KCC) into the committed catalog's profile-scanned kinds:
 * doorways must let a character through, and the floor hole must let
 * one fall through.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORLD_CONSTANTS,
  worldSettingsFromConstants,
  type ObjectInstance,
} from '@officexr/sdk';
import committedCatalog from '../../world-object-kinds.json' with { type: 'json' };
import { createInstanceGeometry } from '../app/geometry-service.ts';
import { BODY_Y, BotPhysicsWorld } from '../bot/BotPhysicsWorld.ts';
import { validateWorldObjectKindCatalog } from '../scenes/world-object-kinds-schema.ts';
import { BotCharacterMovement } from './bot-character-movement.ts';

const VOXEL = 0.5;
const DT = 1 / 60;
const worldSettings = { ...worldSettingsFromConstants(DEFAULT_WORLD_CONSTANTS), charRadius: 0.4 };
const kinds = new Map(validateWorldObjectKindCatalog(committedCatalog).kinds.map((k) => [k.id, k]));
const geometry = createInstanceGeometry({ catalog: { getKind: (id) => kinds.get(id) }, voxelSize: VOXEL });

function place(kindId: string, position: [number, number, number]): ObjectInstance {
  return { id: `${kindId}@${position.join(',')}`, sourceCommandId: kindId, kindId, position };
}

function makeBot(startPos: { x: number; y: number; z: number }, instances: ObjectInstance[]) {
  const physics = new BotPhysicsWorld({
    selfId: 'bot',
    startPos,
    worldSettings,
    instanceAABB: geometry.worldAABB,
    colliderShape: (id) => kinds.get(id)?.colliderShape,
  });
  physics.syncCubes({ cubeSize: VOXEL, instances });
  physics.stepWorld();
  const movement = new BotCharacterMovement(physics, {
    walkSpeed: 2,
    runSpeed: 4,
    movementBlockThreshold: worldSettings.movementBlockThreshold,
  });
  const walk = (dir: { x: number; z: number }, frames: number) => {
    for (let i = 0; i < frames; i++) {
      movement.walk(dir, 0, DT);
      physics.stepWorld();
    }
    return physics.translation();
  };
  return { walk, stand: (frames: number) => walk({ x: 0, z: 0 }, frames) };
}

describe('profile-scanned colliders (real Rapier, committed catalog)', () => {
  describe('prototype_wall_doorway', () => {
    // Wall at world x 0..4, z 0..0.53 on a floor (top y = 0) spanning
    // z −4..4. The opening's x span is the lintel's: the one scanned
    // cuboid that does not reach the base.
    const doorway = kinds.get('prototype_wall_doorway')!;
    const shape = doorway.colliderShape;
    if (shape?.kind !== 'scanned-cuboids' || !doorway.localAABB) {
      throw new Error('prototype_wall_doorway needs a scanned-cuboids colliderShape and localAABB');
    }
    const lintel = shape.cuboids.find((c) => c.min[1] > 0)!;
    const width = doorway.localAABB.max.x - doorway.localAABB.min.x;
    const OPENING_CENTRE_X = ((lintel.min[0] + lintel.max[0]) / 2) * width;
    const OPENING_HALF_WIDTH = ((lintel.max[0] - lintel.min[0]) / 2) * width;
    const scene = [
      place('prototype_floor', [0, -1, -8]),
      place('prototype_floor', [0, -1, 0]),
      place('prototype_wall_doorway', [0, 0, 0]),
    ];

    it('lets the ball walk through the opening centre', () => {
      const bot = makeBot({ x: OPENING_CENTRE_X, y: 0, z: -2 }, scene);
      bot.stand(30);
      const end = bot.walk({ x: 0, z: 1 }, 150);
      expect(end.z).toBeGreaterThan(2);
      expect(end.x).toBeCloseTo(OPENING_CENTRE_X, 3);
    });

    it('blocks the ball aimed at solid wall beside the opening', () => {
      const x = OPENING_CENTRE_X + OPENING_HALF_WIDTH + 0.5;
      const bot = makeBot({ x, y: 0, z: -2 }, scene);
      bot.stand(30);
      const end = bot.walk({ x: 0, z: 1 }, 150);
      // Stopped at the wall face (z = 0), one ball radius short of it.
      expect(end.z).toBeLessThan(0);
      expect(end.z).toBeGreaterThan(-0.6);
    });
  });

  it('drops the ball through prototype_primitive_floor_hole', () => {
    // Floor hole at world x 0..4, y 0..1, z 0..4; the hole is x 1..3, z 1..3.
    const bot = makeBot({ x: 2, y: 1.5, z: 2 }, [place('prototype_primitive_floor_hole', [0, 0, 0])]);
    const end = bot.stand(90);
    expect(end.y + BODY_Y + worldSettings.charRadius).toBeLessThan(0);
  });
});
