import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import type { ObjectInstance, Store, WorldObjects } from '@officexr/sdk';
import { useCubeCatalog } from '../scenes/cube-catalog.ts';
import type { CubeKindEntry } from '../scenes/cube-kinds-schema.ts';
import { CUBE_KINDS, getCubeKind } from '../scenes/cube-kinds.ts';
import {
  buildMaterialForKind,
  extractGeometryFromGltf,
  extractMaterialFromGltf,
} from './cube-material.ts';

// Preload every kind in the bundled-default registry at module load so
// the first scene paint renders without a flash. Kinds added later via
// catalog hydration (Task 4's asset packs) are preloaded lazily inside
// `KindInstanceGroup` via `useGLTF` itself, which caches by URL.
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
 * Subscribes to the live cube catalog so per-kind material overrides
 * (tint, opacity, roughness, metalness, emissive) and the per-kind
 * default scale propagate from the Object editor.
 *
 * Coords: each instance's `position` is integer voxel space; world
 * position = `position * cubeSize`.
 */
export function ObjectInstances({ store }: ObjectInstancesProps) {
  const [snapshot, setSnapshot] = useState<WorldObjects>(
    () => store.getState().worldObjects,
  );
  useEffect(() => {
    // Re-read the store before installing the subscription. If a
    // setWorldObjects landed between the lazy useState init (which
    // ran during render) and this effect (which ran after commit),
    // the subscription would miss it and `snapshot` would stay
    // pinned to the empty default. The picker's bootstrap fires
    // through this gap on first paint — the rendered cube field
    // was permanently empty even though the store carried the map.
    setSnapshot(store.getState().worldObjects);
    return store.subscribe(
      (s) => s.worldObjects,
      (next) => setSnapshot(next),
    );
  }, [store]);

  const kinds = useCubeCatalog();
  const kindById = useMemo(() => {
    const m = new Map<string, CubeKindEntry>();
    for (const k of kinds) m.set(k.id, k);
    return m;
  }, [kinds]);

  // Group instances by kind so each kind gets one InstancedMesh.
  // Only kinds that actually have at least one instance produce a
  // `<KindInstanceGroup>` — every group triggers `useGLTF(...)` which
  // suspends until the GLTF resolves. Rendering one group per
  // catalog entry instead means a 281-kind catalog (post-`pnpm
  // asset-packs:install`) attempts to load all 281 GLTFs at mount,
  // which hangs the Debug scene until they ALL complete. Filtering
  // to the actually-used kinds keeps mount work proportional to the
  // scene's content.
  const usedKinds = useMemo(() => {
    const byKind = new Map<string, ObjectInstance[]>();
    for (const inst of snapshot.instances) {
      let arr = byKind.get(inst.kindId);
      if (!arr) {
        arr = [];
        byKind.set(inst.kindId, arr);
      }
      arr.push(inst);
    }
    const out: Array<{ kind: CubeKindEntry; instances: ObjectInstance[] }> = [];
    for (const [kindId, instances] of byKind) {
      const kind = kindById.get(kindId);
      if (!kind) continue;
      out.push({ kind, instances });
    }
    return out;
  }, [snapshot, kindById]);

  // Publish a render-marker on the window for regression tests.
  // If <ObjectInstances> is ever again forgotten in Scene.tsx (as
  // happened during the studio refactor), `__OFFICE_OBJECT_INSTANCES__`
  // is undefined and the e2e test "Map switch in Debug actually
  // renders the new cubes" fails fast with a clear message. Also
  // exposes per-kind counts so a "mesh count out of sync with store"
  // class of bug gets caught.
  useEffect(() => {
    const win = globalThis as unknown as {
      __OFFICE_OBJECT_INSTANCES__?: {
        storeCount: number;
        perKind: Array<{ kindId: string; count: number }>;
      };
    };
    win.__OFFICE_OBJECT_INSTANCES__ = {
      storeCount: snapshot.instances.length,
      perKind: usedKinds.map(({ kind, instances }) => ({
        kindId: kind.id,
        count: instances.length,
      })),
    };
    return () => {
      delete win.__OFFICE_OBJECT_INSTANCES__;
    };
  }, [snapshot, usedKinds]);

  return (
    <>
      {usedKinds.map(({ kind, instances }) => (
        <KindInstanceGroup
          key={kind.id}
          kind={kind}
          instances={instances}
          cubeSize={snapshot.cubeSize}
        />
      ))}
    </>
  );
}

interface KindInstanceGroupProps {
  kind: CubeKindEntry;
  instances: ObjectInstance[];
  cubeSize: number;
}

// KayKit BlockBits cubes have beveled corners — a slight overlap hides
// the seams between adjacent instances. Kept as a per-renderer constant
// so the catalog-side `kind.scale` stays a clean "1 = no change"
// semantic.
const SEAM_OVERLAP = 1.05;

function KindInstanceGroup({ kind, instances, cubeSize }: KindInstanceGroupProps) {
  const gltf = useGLTF(kind.gltfPath);
  const geom = useMemo(() => extractGeometryFromGltf(gltf.scene), [gltf.scene]);
  // Clone the GLTF material per kind so per-kind override edits are
  // isolated from any other <ObjectInstances> mount sharing the same
  // GLTF asset. The clone happens once per kind material-override
  // signature; in-place mutation of an existing clone is avoided so
  // React's effect doesn't fight the renderer's frame loop.
  const mat = useMemo(
    () => buildMaterialForKind(extractMaterialFromGltf(gltf.scene), kind),
    [
      gltf.scene,
      kind.tint,
      kind.opacity,
      kind.roughness,
      kind.metalness,
      kind.emissive,
      kind.emissiveIntensity,
    ],
  );

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
    const s = SEAM_OVERLAP * kind.scale;
    const scale = new THREE.Vector3(s, s, s);
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
    // `mat` is in the deps because changing material re-memoizes the
    // `args` tuple below, which forces R3F to construct a fresh
    // InstancedMesh — `meshRef.current` then points at a new mesh with
    // uninitialized matrices. Re-running this effect refills them so a
    // live tint/opacity edit from the Object editor doesn't scramble
    // cube positions.
  }, [instances, cubeSize, kind.scale, mat]);

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

/** Convenience accessor for editor code that needs to look up a kind
 * from a raycast hit. Re-exported for ergonomics. */
export { getCubeKind };
