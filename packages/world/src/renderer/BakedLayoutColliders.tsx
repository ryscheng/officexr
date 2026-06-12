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
 * one world-space AABB per Mesh, the legacy behaviour. Safe because
 * pre-extras GLBs were baked with the broken non-merging pipeline —
 * their per-object mesh nodes are still intact.
 *
 * Either way the output shape is the same: one `<CuboidCollider>` per
 * descriptor in a single fixed `<RigidBody>` on `WALL_GROUPS`, matching
 * `<MapColliders>` so existing player collision code just works.
 *
 * `three` IS allowed in renderer files per CLAUDE.md rules.
 */

import React, { Suspense } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { RigidBody, CuboidCollider } from '@react-three/rapier';
import { getVersion } from '../app/bake-registry.ts';
import { parseEmbeddedColliders } from '../app/baked-collider-extras.ts';
import { WALL_GROUPS } from '../physics/groups.ts';
import { BakedLayoutErrorBoundary } from './BakedLayout.tsx';

// ---------------------------------------------------------------------------
// Inner component (inside Suspense — can use useGLTF)
// ---------------------------------------------------------------------------

interface MeshAABB {
  center: [number, number, number];
  halfExtents: [number, number, number];
}

function extractMeshAABBs(scene: THREE.Object3D): MeshAABB[] {
  const box = new THREE.Box3();
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  const results: MeshAABB[] = [];

  // Force a matrix update so `setFromObject(mesh)` uses the correct
  // world transform even though we haven't rendered yet.
  scene.updateMatrixWorld(true);

  scene.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    if (!child.geometry) return;

    // Compute world-space AABB from the mesh and its applied transforms.
    box.setFromObject(child);
    if (box.isEmpty()) return;

    box.getCenter(center);
    box.getSize(size);

    results.push({
      center: [center.x, center.y, center.z],
      halfExtents: [size.x / 2, size.y / 2, size.z / 2],
    });
  });

  return results;
}

interface BakedLayoutCollidersInnerProps {
  effectiveUrl: string;
}

function BakedLayoutCollidersInner({ effectiveUrl }: BakedLayoutCollidersInnerProps) {
  const gltf = useGLTF(effectiveUrl);

  // Preferred path: the physics cuboids the bake embedded in the scene
  // extras (GLTFLoader surfaces glTF `extras` as `userData`).
  const embedded = parseEmbeddedColliders(gltf.scene.userData);
  let aabbs: MeshAABB[];
  if (embedded) {
    aabbs = embedded.map((c) => ({
      center: [c.center.x, c.center.y, c.center.z],
      halfExtents: [c.halfExtents.x, c.halfExtents.y, c.halfExtents.z],
    }));
  } else {
    // Stale bake (pre-extras GLB). Its meshes are still one-per-object
    // (the old non-merging pipeline), so per-mesh AABBs remain a valid
    // collider source. Warn so the user knows to re-save the layout —
    // a re-bake upgrades it to embedded colliders + merged visuals.
    console.warn(
      `[BakedLayoutColliders] "${effectiveUrl}" carries no embedded collider ` +
        'extras (stale bake). Falling back to per-mesh AABB colliders; ' +
        're-save the layout to re-bake it.',
    );
    aabbs = extractMeshAABBs(gltf.scene);
  }

  if (aabbs.length === 0) return null;

  return (
    <RigidBody type="fixed" colliders={false} userData={{ kind: 'wall' }}>
      {aabbs.map((aabb, i) => (
        <CuboidCollider
          key={i}
          position={aabb.center}
          args={aabb.halfExtents}
          collisionGroups={WALL_GROUPS}
        />
      ))}
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
}: BakedLayoutCollidersProps) {
  const version = layoutName ? getVersion(layoutName) : 0;
  const effectiveUrl = version > 0 ? `${gltfPath}?v=${version}` : gltfPath;

  // Wrap in the shared error boundary so a missing/erroring GLB
  // doesn't tear down the canvas — same UX as <BakedLayout>. The
  // player will pass through unbaked layouts until the bake lands;
  // that's preferable to a full app crash.
  return (
    <BakedLayoutErrorBoundary resetKey={layoutName ?? gltfPath} fallback={null}>
      <Suspense fallback={null}>
        <BakedLayoutCollidersInner effectiveUrl={effectiveUrl} />
      </Suspense>
    </BakedLayoutErrorBoundary>
  );
}
