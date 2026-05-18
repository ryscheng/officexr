/**
 * `<BakedLayoutColliders>` — static Rapier colliders derived from a baked
 * layout GLB's mesh AABBs.
 *
 * Traverses the loaded GLTF scene, extracts one world-space AABB per Mesh,
 * and emits one `<CuboidCollider>` per mesh wrapped in a single fixed
 * `<RigidBody>`.  Uses the same `WALL_GROUPS` interaction group as
 * `<MapColliders>` so existing player collision code just works.
 *
 * `three` IS allowed in renderer files per CLAUDE.md rules.
 */

import React, { Suspense } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { RigidBody, CuboidCollider } from '@react-three/rapier';
import { getVersion } from '../app/bake-registry.ts';
import { WALL_GROUPS } from '../physics/groups.ts';

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
  const aabbs = extractMeshAABBs(gltf.scene);

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

  return (
    <Suspense fallback={null}>
      <BakedLayoutCollidersInner effectiveUrl={effectiveUrl} />
    </Suspense>
  );
}
