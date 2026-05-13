import React, { useMemo } from 'react';
import { RigidBody, CuboidCollider } from '@react-three/rapier';
import type { WorldMap } from '@officexr/sdk';
import { CUBE_SIZE } from './config.ts';
import { WALL_GROUPS } from '../physics/groups.ts';
import { worldMapToWalls } from '../physics/worldMapToWalls.ts';

/**
 * Static wall colliders around the perimeter of the floor. Drives the
 * "character clamps at the floor edge" behaviour that `resolveMovement`
 * used to enforce via `halfExtent − charRadius` arithmetic.
 *
 * Sits inside `<Physics>`. The visible floor is still rendered by
 * `<Floor>` — these walls are invisible.
 */
export function FloorColliders({ gridSize }: { gridSize: number }) {
  const walls = useMemo(() => {
    const fakeMap: WorldMap = {
      gridSize,
      cubeSize: CUBE_SIZE,
      origin: { x: 0, z: 0 },
      layers: [],
      kinds: {},
    };
    return worldMapToWalls(fakeMap);
  }, [gridSize]);

  return (
    <RigidBody type="fixed" colliders={false} userData={{ kind: 'wall' }}>
      {walls.map((w, i) => (
        <CuboidCollider
          key={i}
          position={[w.center.x, w.center.y, w.center.z]}
          args={[w.halfExtents.x, w.halfExtents.y, w.halfExtents.z]}
          collisionGroups={WALL_GROUPS}
        />
      ))}
    </RigidBody>
  );
}
