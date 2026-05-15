import React, { useEffect, useState } from 'react';
import { RigidBody, CuboidCollider } from '@react-three/rapier';
import type { Store, WorldObjects } from '@officexr/sdk';
import { WALL_GROUPS } from '../physics/groups.ts';

interface MapCollidersProps {
  store: Store;
}

/**
 * One static cuboid collider per cube in `state.worldObjects`. Replaces
 * the old `FloorColliders` (which built four perimeter walls around a
 * fixed `gridSize × gridSize` area regardless of the map). The Map
 * Editor is now the source of truth: wherever an authored cube sits in
 * `worldObjects.instances`, the player physically bumps into it.
 *
 * Subscribes via the same lazy-init + catch-up pattern as
 * `ObjectInstances`: read the store inside the useEffect before
 * installing the subscription so a `setWorldObjects` that lands
 * between render and effect-commit isn't missed.
 *
 * One `<RigidBody type="fixed">` holds every collider so Rapier
 * doesn't pay per-cube rigid-body bookkeeping; React reconciliation
 * keys each collider by `inst.id` so map switches only diff the
 * cubes that actually changed.
 */
export function MapColliders({ store }: MapCollidersProps) {
  const [snapshot, setSnapshot] = useState<WorldObjects>(
    () => store.getState().worldObjects,
  );
  useEffect(() => {
    setSnapshot(store.getState().worldObjects);
    return store.subscribe(
      (s) => s.worldObjects,
      (next) => setSnapshot(next),
    );
  }, [store]);

  const cubeSize = snapshot.cubeSize;
  const half = cubeSize / 2;

  return (
    <RigidBody type="fixed" colliders={false} userData={{ kind: 'wall' }}>
      {snapshot.instances.map((inst) => {
        const wx = inst.position[0] * cubeSize;
        // Match the visual cube placement in ObjectInstances:
        // world y = voxel y * cubeSize + cubeSize/2 (the +cubeSize/2
        // lifts the cube's centre up from its bottom face).
        const wy = inst.position[1] * cubeSize + half;
        const wz = inst.position[2] * cubeSize;
        return (
          <CuboidCollider
            key={inst.id}
            position={[wx, wy, wz]}
            args={[half, half, half]}
            collisionGroups={WALL_GROUPS}
          />
        );
      })}
    </RigidBody>
  );
}
