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

/**
 * Magic-id prefix recognized by ObjectInstances to render a plain
 * `<boxGeometry>` cube instead of resolving a catalog entry +
 * loading a GLB. The Mugshot mode uses this for an A/B diagnostic:
 * same colliders, same character, same camera — only the visible
 * cube geometry differs. If feet sit on primitive boxes but sink
 * into GLB cubes, the GLB authoring is the suspect.
 *
 * Production code paths (Debug, Map editor, Room editor) never
 * emit a `__primitive_` instance — these kindIds are exclusive to
 * the Mugshot diagnostic harness.
 */
const PRIMITIVE_PREFIX = '__primitive_';
const PRIMITIVE_COLORS: Record<string, string> = {
  __primitive_blue: '#3b6bf2',
  __primitive_stone: '#a8a8a8',
};
const PRIMITIVE_FALLBACK_COLOR = '#ff00ff';

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
  // Two buckets:
  //   - `usedKinds`: real catalog kinds (load via useGLTF).
  //   - `usedPrimitives`: `__primitive_<color>` magic ids (plain
  //     BoxGeometry, no GLB load). Used only by Mugshot's A/B
  //     diagnostic; production scenes never emit these.
  //
  // Filtering to actually-used kinds (rather than the full
  // catalog) keeps mount work proportional to scene content — a
  // 281-kind catalog (post-`pnpm asset-packs:install`) would
  // otherwise trigger 281 useGLTF suspensions on mount.
  const { usedKinds, usedPrimitives } = useMemo(() => {
    const byKind = new Map<string, ObjectInstance[]>();
    for (const inst of snapshot.instances) {
      let arr = byKind.get(inst.kindId);
      if (!arr) {
        arr = [];
        byKind.set(inst.kindId, arr);
      }
      arr.push(inst);
    }
    const kinds: Array<{ kind: CubeKindEntry; instances: ObjectInstance[] }> = [];
    const primitives: Array<{
      kindId: string;
      color: string;
      instances: ObjectInstance[];
    }> = [];
    for (const [kindId, instances] of byKind) {
      if (kindId.startsWith(PRIMITIVE_PREFIX)) {
        primitives.push({
          kindId,
          color: PRIMITIVE_COLORS[kindId] ?? PRIMITIVE_FALLBACK_COLOR,
          instances,
        });
        continue;
      }
      const kind = kindById.get(kindId);
      if (!kind) continue;
      kinds.push({ kind, instances });
    }
    return { usedKinds: kinds, usedPrimitives: primitives };
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
      perKind: [
        ...usedKinds.map(({ kind, instances }) => ({
          kindId: kind.id,
          count: instances.length,
        })),
        ...usedPrimitives.map(({ kindId, instances }) => ({
          kindId,
          count: instances.length,
        })),
      ],
    };
    return () => {
      delete win.__OFFICE_OBJECT_INSTANCES__;
    };
  }, [snapshot, usedKinds, usedPrimitives]);

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
      {usedPrimitives.map(({ kindId, color, instances }) => (
        <PrimitiveInstanceGroup
          key={kindId}
          kindId={kindId}
          color={color}
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
    // Scale is exactly `kind.scale` — no seam-overlap fudge. The
    // previous SEAM_OVERLAP=1.05 inflated each instance 5 % to hide
    // groove lines between bevelled-edge KayKit blocks; but the
    // visual top of a cube ended up 0.05 m higher than its physics
    // collider (in <MapColliders>), so the character's feet rested
    // on the collider top while visually appearing to sink slightly
    // into the cube. Visual seams are an acceptable trade for a
    // correctly aligned standing surface.
    const s = kind.scale;
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

interface PrimitiveInstanceGroupProps {
  kindId: string;
  color: string;
  instances: ObjectInstance[];
  cubeSize: number;
}

/**
 * Twin of `KindInstanceGroup` for `__primitive_<color>` magic
 * kindIds: plain `BoxGeometry` cubes at the exact world positions
 * the per-cube colliders occupy. No useGLTF, no kind.scale, no
 * SEAM_OVERLAP — by design, so the diagnostic isolates "what does
 * the character render look like when the visible cube is
 * mathematically identical to its physics collider?"
 *
 * We construct the geometry + material locally, which means we OWN
 * disposal (unlike useGLTF, which manages its own asset cache).
 */
function PrimitiveInstanceGroup({
  kindId,
  color,
  instances,
  cubeSize,
}: PrimitiveInstanceGroupProps) {
  const geom = useMemo(
    () => new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize),
    [cubeSize],
  );
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color }), [color]);
  useEffect(
    () => () => {
      geom.dispose();
      mat.dispose();
    },
    [geom, mat],
  );

  const meshRef = useRef<THREE.InstancedMesh>(null);
  const capacity = Math.max(1, instances.length);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    // Hard-coded unity scale — the diagnostic exists to isolate
    // geometry from `kind.scale` tweaks. If someone later wants
    // scale support here, the answer is "use the GLB path".
    const scale = new THREE.Vector3(1, 1, 1);
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
  }, [instances, cubeSize, mat]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[geom, mat, capacity]}
      castShadow
      receiveShadow
      userData={{ kindId, isObjectInstanceMesh: true, isPrimitive: true }}
    />
  );
}

/** Convenience accessor for editor code that needs to look up a kind
 * from a raycast hit. Re-exported for ergonomics. */
export { getCubeKind };
