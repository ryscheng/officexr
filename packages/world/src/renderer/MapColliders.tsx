import React from 'react';
import { RigidBody, CuboidCollider, TrimeshCollider } from '@react-three/rapier';
import type { Store } from '@officexr/sdk';
import { useApplication } from '../react/application-context.tsx';
import { WALL_GROUPS } from '../physics/groups.ts';
import { worldObjectsToColliders } from '../physics/rules.ts';
import { useStoreWorldObjects, type ExcludeInstance } from './useStoreWorldObjects.ts';

interface MapCollidersProps {
  store: Store;
  /** Instances to leave out, e.g. those a baked layout already collides. */
  exclude?: ExcludeInstance;
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
export function MapColliders({ store, exclude }: MapCollidersProps) {
  const { geometry, catalog } = useApplication();
  const snapshot = useStoreWorldObjects(store, exclude);

  // Build collider descriptors using the shared helper so the browser
  // collider layout exactly mirrors what BotPhysicsWorld.syncCubes
  // builds on the server side — one source of truth for collider
  // geometry. Cuboids for boxes/stairs; trimeshes for slope kinds.
  const colliders = worldObjectsToColliders(
    snapshot,
    geometry.worldAABB,
    (kindId) => catalog.getKind(kindId)?.colliderShape,
  );

  return (
    <RigidBody type="fixed" colliders={false} userData={{ kind: 'wall' }}>
      {colliders.map((c, i) =>
        c.type === 'cuboid' ? (
          <CuboidCollider
            key={i}
            position={[c.center.x, c.center.y, c.center.z]}
            args={[c.halfExtents.x, c.halfExtents.y, c.halfExtents.z]}
            collisionGroups={WALL_GROUPS}
          />
        ) : (
          <TrimeshCollider
            key={i}
            args={[new Float32Array(c.vertices), new Uint32Array(c.indices)]}
            collisionGroups={WALL_GROUPS}
          />
        ),
      )}
    </RigidBody>
  );
}
