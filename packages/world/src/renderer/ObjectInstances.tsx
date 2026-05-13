import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import type { ObjectInstance, Store, WorldObjects } from '@officexr/sdk';
import { CUBE_KINDS, getCubeKind, type CubeKindDef } from '../scenes/cube-kinds.ts';

// Preload every kind in the curated registry. The studio loads with a
// known palette, so blocking here is fine and the first scene paint
// renders without a flash.
for (const kind of CUBE_KINDS) {
  useGLTF.preload(kind.gltfPath);
}

interface ObjectInstancesProps {
  store: Store;
}

/**
 * Renders the compiled scene's cube instances as one InstancedMesh per
 * `kindId`. Reads `state.worldObjects` via a narrow store subscription
 * so it only re-builds matrices when the compiled snapshot actually
 * changes (the studio's Scenes mode pushes a new snapshot whenever
 * commands edit; gameplay broadcast applies snapshots from peers).
 *
 * Coords: each instance's `position` is integer voxel space; world
 * position = `position * cubeSize`.
 */
export function ObjectInstances({ store }: ObjectInstancesProps) {
  const [snapshot, setSnapshot] = useState<WorldObjects>(
    () => store.getState().worldObjects,
  );
  useEffect(() => {
    return store.subscribe(
      (s) => s.worldObjects,
      (next) => setSnapshot(next),
    );
  }, [store]);

  // Group instances by kind so each kind gets one InstancedMesh.
  const byKind = useMemo(() => {
    const m = new Map<string, ObjectInstance[]>();
    for (const inst of snapshot.instances) {
      let arr = m.get(inst.kindId);
      if (!arr) {
        arr = [];
        m.set(inst.kindId, arr);
      }
      arr.push(inst);
    }
    return m;
  }, [snapshot]);

  // Render one group per kind in registry order so React keys stay
  // stable when the snapshot changes (kinds present in `byKind` are
  // preserved; absent kinds render zero instances which costs nothing).
  return (
    <>
      {CUBE_KINDS.map((kind) => (
        <KindInstanceGroup
          key={kind.id}
          kind={kind}
          instances={byKind.get(kind.id) ?? []}
          cubeSize={snapshot.cubeSize}
        />
      ))}
    </>
  );
}

interface KindInstanceGroupProps {
  kind: CubeKindDef;
  instances: ObjectInstance[];
  cubeSize: number;
}

function KindInstanceGroup({ kind, instances, cubeSize }: KindInstanceGroupProps) {
  const gltf = useGLTF(kind.gltfPath);
  const geom = useMemo(() => extractGeometry(gltf.scene), [gltf.scene]);
  const mat = useMemo(() => extractMaterial(gltf.scene), [gltf.scene]);

  const meshRef = useRef<THREE.InstancedMesh>(null);
  // Allocate at least 1 instance so InstancedMesh isn't constructed
  // with a zero count (Three throws on count=0 in some versions). We
  // set `count` per-frame to the actual instance count.
  const capacity = Math.max(1, instances.length);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    // KayKit BlockBits cubes have beveled corners — a slight overlap
    // hides the seams between adjacent instances, matching Floor.tsx.
    const overlap = 1.05;
    const scale = new THREE.Vector3(overlap, overlap, overlap);
    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i];
      pos.set(
        inst.position[0] * cubeSize,
        inst.position[1] * cubeSize + cubeSize / 2,
        inst.position[2] * cubeSize,
      );
      m.compose(pos, quat, scale);
      mesh.setMatrixAt(i, m);
    }
    mesh.count = instances.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [instances, cubeSize]);

  // userData lets the editor's R3F overlay raycast and identify which
  // kind / instance was hit. The caller can read `intersection.object.userData.kindId`
  // to dispatch back to the inspector.
  return (
    <instancedMesh
      ref={meshRef}
      args={[geom, mat, capacity]}
      castShadow
      receiveShadow
      userData={{ kindId: kind.id, isObjectInstanceMesh: true }}
    />
  );
}

function extractGeometry(scene: THREE.Object3D): THREE.BufferGeometry {
  let geom: THREE.BufferGeometry | null = null;
  scene.traverse((o) => {
    if (!geom && (o as THREE.Mesh).isMesh) geom = (o as THREE.Mesh).geometry;
  });
  if (!geom) throw new Error('No mesh geometry in cube GLTF');
  return geom;
}

function extractMaterial(scene: THREE.Object3D): THREE.Material {
  let mat: THREE.Material | null = null;
  scene.traverse((o) => {
    if (!mat && (o as THREE.Mesh).isMesh)
      mat = (o as THREE.Mesh).material as THREE.Material;
  });
  if (!mat) throw new Error('No mesh material in cube GLTF');
  return mat;
}

/** Convenience accessor for editor code that needs to look up a kind
 * from a raycast hit. Re-exported for ergonomics. */
export { getCubeKind };
