import React, { useEffect, useState } from 'react';
import { RigidBody, CuboidCollider } from '@react-three/rapier';
import type { Store, WorldObjects } from '@officexr/sdk';
import { useApplication } from '../react/application-context.tsx';
import { WALL_GROUPS } from '../physics/groups.ts';

interface MapCollidersProps {
  store: Store;
}

/**
 * One static cuboid collider per placed object in `state.worldObjects`.
 *
 * Position + half-extents are derived from the **canonical
 * `InstanceGeometryService`** — same source of truth the renderer
 * uses for the visible mesh placement. Before this refactor the
 * colliders hardcoded `[half, half, half]` half-extents
 * (one-voxel-size everywhere) and a `+vs/2` Y offset that worked only
 * for objects exactly one voxel in size. After the per-kind dimensions
 * rollout that became wrong for every kind larger than one voxel —
 * players walked through 2 m blocks while the visible mesh appeared
 * to block them.
 *
 * Now: collider center = AABB center, collider half-extents = AABB
 * half-extents. Player collision matches the visible mesh exactly.
 */
export function MapColliders({ store }: MapCollidersProps) {
  const { geometry } = useApplication();
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

  return (
    <RigidBody type="fixed" colliders={false} userData={{ kind: 'wall' }}>
      {snapshot.instances.map((inst) => {
        const aabb = geometry.worldAABB(inst.position, inst.kindId);
        const cx = (aabb.min[0] + aabb.max[0]) / 2;
        const cy = (aabb.min[1] + aabb.max[1]) / 2;
        const cz = (aabb.min[2] + aabb.max[2]) / 2;
        const hx = (aabb.max[0] - aabb.min[0]) / 2;
        const hy = (aabb.max[1] - aabb.min[1]) / 2;
        const hz = (aabb.max[2] - aabb.min[2]) / 2;
        return (
          <CuboidCollider
            key={inst.id}
            position={[cx, cy, cz]}
            args={[hx, hy, hz]}
            collisionGroups={WALL_GROUPS}
          />
        );
      })}
    </RigidBody>
  );
}
