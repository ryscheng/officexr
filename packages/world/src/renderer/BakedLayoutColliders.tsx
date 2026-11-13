/**
 * `<BakedLayoutColliders>` — static Rapier colliders for a baked layout
 * GLB.
 *
 * PRIMARY SOURCE: the collider cuboids the bake embedded in the GLB's
 * scene `extras` (see `app/baked-collider-extras.ts`). These come from
 * `worldObjectsToCuboids` — the exact same physics helper MapColliders
 * (unbaked rooms) and BotPhysicsWorld (bots) use, including the
 * compound-steps staircase override — so the player walks on identical
 * geometry whether a room is baked or not. The visual mesh is merged
 * (and possibly simplified) by the bake optimizer, so it can no longer
 * describe physics.
 *
 * FALLBACK (stale pre-extras bakes only): traverse the scene and emit
 * one layout-local AABB per Mesh, the legacy behaviour. Safe because
 * pre-extras GLBs were baked with the broken non-merging pipeline —
 * their per-object mesh nodes are still intact.
 *
 * Either way the output shape is the same: one `<CuboidCollider>` per
 * descriptor in a single fixed `<RigidBody>` on `WALL_GROUPS`, matching
 * `<MapColliders>` so existing player collision code just works.
 *
 * `three` IS allowed in renderer files per CLAUDE.md rules.
 */

import React, { Suspense, useEffect, useEffectEvent, useMemo } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { RigidBody, CuboidCollider, TrimeshCollider } from '@react-three/rapier';
import { getVersion } from '../app/bake-registry.ts';
import { parseEmbeddedColliders } from '../app/baked-collider-extras.ts';
import { WALL_GROUPS } from '../physics/groups.ts';
import type { ColliderDescriptor } from '../physics/rules.ts';
import { BakedLayoutErrorBoundary } from './BakedLayout.tsx';
import type { PlacementTransform } from './placement-transform.ts';

// ---------------------------------------------------------------------------
// Inner component (inside Suspense — can use useGLTF)
// ---------------------------------------------------------------------------

function extractMeshAABBs(scene: THREE.Object3D): ColliderDescriptor[] {
  const box = new THREE.Box3();
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  const results: ColliderDescriptor[] = [];

  // Force a matrix update so `setFromObject(mesh)` sees current
  // transforms even though we haven't rendered yet.
  scene.updateMatrixWorld(true);

  scene.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    if (!child.geometry) return;

    box.setFromObject(child);
    if (box.isEmpty()) return;

    box.getCenter(center);
    box.getSize(size);

    results.push({
      type: 'cuboid',
      center: { x: center.x, y: center.y, z: center.z },
      halfExtents: { x: size.x / 2, y: size.y / 2, z: size.z / 2 },
    });
  });

  return results;
}

/** The bake's embedded physics descriptors, else (stale pre-extras bake) per-mesh AABBs. */
function layoutColliders(scene: THREE.Object3D, effectiveUrl: string): ColliderDescriptor[] {
  // GLTFLoader surfaces glTF `extras` as `userData`.
  const embedded = parseEmbeddedColliders(scene.userData);
  if (embedded) {
    return embedded;
  }
  // A stale bake's meshes are still one-per-object (the old
  // non-merging pipeline), so per-mesh AABBs remain a valid collider
  // source. Warn so the user knows to re-save the layout — a re-bake
  // upgrades it to embedded colliders + merged visuals.
  console.warn(
    `[BakedLayoutColliders] "${effectiveUrl}" carries no embedded collider ` +
      'extras (stale bake). Falling back to per-mesh AABB colliders; ' +
      're-save the layout to re-bake it.',
  );
  return extractMeshAABBs(scene);
}

interface BakedLayoutCollidersInnerProps {
  effectiveUrl: string;
  transform?: PlacementTransform;
  onReady?: (colliders: readonly ColliderDescriptor[]) => void;
}

function BakedLayoutCollidersInner({ effectiveUrl, transform, onReady }: BakedLayoutCollidersInnerProps) {
  const gltf = useGLTF(effectiveUrl);
  const colliders = useMemo(() => layoutColliders(gltf.scene, effectiveUrl), [gltf.scene, effectiveUrl]);
  // Child effects run first, so the colliders below exist by the time this fires.
  const notifyReady = useEffectEvent(() => onReady?.(colliders));
  useEffect(() => {
    notifyReady();
  }, [effectiveUrl]);

  if (colliders.length === 0) return null;
  return (
    <RigidBody type="fixed" colliders={false} userData={{ kind: 'wall' }} {...transform}>
      {colliders.map((d, i) =>
        d.type === 'cuboid' ? (
          <CuboidCollider
            key={i}
            position={[d.center.x, d.center.y, d.center.z]}
            args={[d.halfExtents.x, d.halfExtents.y, d.halfExtents.z]}
            collisionGroups={WALL_GROUPS}
          />
        ) : (
          <TrimeshCollider
            key={i}
            args={[
              new Float32Array(d.vertices),
              new Uint32Array(d.indices),
            ]}
            collisionGroups={WALL_GROUPS}
          />
        ),
      )}
    </RigidBody>
  );
}

// ---------------------------------------------------------------------------
// BakedLayoutColliders (exported)
// ---------------------------------------------------------------------------

export interface BakedLayoutCollidersProps {
  /** URL to the pre-baked GLB, e.g. `/api/baked-layouts/myLayout`. */
  gltfPath: string;
  /**
   * Layout name used to look up the current bake version for cache-busting.
   * Must match the name used in `<BakedLayout>` so the two components
   * cache-bust in lockstep.
   */
  layoutName?: string;
  /** Where the layout is placed; the colliders are layout-local, so this goes on their `RigidBody`. */
  transform?: PlacementTransform;
  /** Fires once the colliders have mounted (also when there are none), again per new layout. */
  onReady?: (colliders: readonly ColliderDescriptor[]) => void;
  onError?: (error: Error) => void;
}

/**
 * Derives static Rapier colliders from the mesh AABBs of a baked layout GLB.
 *
 * Cache-busts in lockstep with `<BakedLayout>` by reading the version from
 * `BakeRegistry.getVersion(layoutName)`.  Because this component only READS
 * the version at mount time (no subscription needed — the collider rebuild is
 * driven by the parent re-mounting after a version change), this is simpler
 * than `<BakedLayout>` and doesn't need a subscribe effect.
 */
export function BakedLayoutColliders({
  gltfPath,
  layoutName,
  transform,
  onReady,
  onError,
}: BakedLayoutCollidersProps) {
  const version = layoutName ? getVersion(layoutName) : 0;
  const effectiveUrl = version > 0 ? `${gltfPath}?v=${version}` : gltfPath;

  // Wrap in the shared error boundary so a missing/erroring GLB
  // doesn't tear down the canvas — same UX as <BakedLayout>. The
  // player will pass through unbaked layouts until the bake lands;
  // that's preferable to a full app crash.
  return (
    <BakedLayoutErrorBoundary resetKey={layoutName ?? gltfPath} fallback={null} onError={onError}>
      <Suspense fallback={null}>
        <BakedLayoutCollidersInner effectiveUrl={effectiveUrl} transform={transform} onReady={onReady} />
      </Suspense>
    </BakedLayoutErrorBoundary>
  );
}
