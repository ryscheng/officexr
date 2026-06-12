import React, { useEffect, useState } from 'react';
import { RigidBody, CuboidCollider } from '@react-three/rapier';
import type { Store, WorldObjects } from '@officexr/sdk';
import { useApplication } from '../react/application-context.tsx';
import { WALL_GROUPS } from '../physics/groups.ts';
import { worldObjectsToCuboids } from '../physics/rules.ts';

interface MapCollidersProps {
  store: Store;
}

/**
 * Static cuboid colliders for every placed object in `state.worldObjects`.
 *
 * Position + half-extents are derived from the **canonical
 * `InstanceGeometryService`** — same source of truth the renderer uses
 * for the visible mesh placement.
 *
 * Default (all kinds): one CuboidCollider per placed object, sized to
 * the kind's AABB. This matches the visible mesh exactly for rectangular
 * objects (colored blocks, walls, floors, etc.).
 *
 * Override (kinds with `colliderShape: 'compound-steps'`): multiple
 * CuboidColliders per placed object, one per step column. This creates
 * a staircase topology instead of an opaque bounding-box wall, allowing
 * Rapier's kinematic character controller to climb the steps.
 *
 * OCP note: the compound-step path is additive. The default single-AABB
 * path is unchanged for all kinds that do not declare a `colliderShape`.
 * Future shape variants (slope, hollow, etc.) would add new branches in
 * `worldObjectsToCuboids` without touching this component.
 */
export function MapColliders({ store }: MapCollidersProps) {
  const { geometry, catalog } = useApplication();
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

  // Build a flat array of cuboid descriptors using the shared helper so
  // the browser collider layout exactly mirrors what BotPhysicsWorld.syncCubes
  // builds on the server side — one source of truth for collider geometry.
  const cuboids = worldObjectsToCuboids(
    snapshot,
    (pos, kindId) => geometry.worldAABB(pos, kindId),
    (kindId) => catalog.getKind(kindId)?.colliderShape,
  );

  return (
    <RigidBody type="fixed" colliders={false} userData={{ kind: 'wall' }}>
      {cuboids.map((c, i) => (
        <CuboidCollider
          key={i}
          position={[c.center.x, c.center.y, c.center.z]}
          args={[c.halfExtents.x, c.halfExtents.y, c.halfExtents.z]}
          collisionGroups={WALL_GROUPS}
        />
      ))}
    </RigidBody>
  );
}
