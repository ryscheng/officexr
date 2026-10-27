import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import type { ObjectInstance, Store, WorldObjects } from '@officexr/sdk';
import { useStoreWorldObjects, type ExcludeInstance } from './useStoreWorldObjects.ts';
import { modelUrl } from '../app/asset-url.ts';
import type { InstanceGeometryService } from '../app/types.ts';
import { useApplication, useCatalog } from '../react/application-context.tsx';
import {
  validateWorldObjectKindCatalog,
  type WorldObjectKind,
} from '../scenes/world-object-kinds-schema.ts';
// Static preload list: the bundled-default catalog. Used at module
// load to warm drei's useGLTF cache so the first scene paint doesn't
// flash. Kinds beyond the bundled defaults are preloaded lazily by
// useGLTF when the catalog service hydrates with the live JSON.
import defaultCatalogJson from '../../world-object-kinds.default.json' with { type: 'json' };
import {
  buildMaterialForKind,
  extractGeometryFromGltf,
  extractMaterialFromGltf,
} from './cube-material.ts';
// Single source of truth for the primitive-box diagnostic: the prefix
// + 2 m size live in the geometry service so the collider it derives
// (MapColliders → worldAABB) matches the box this file renders.
import {
  PRIMITIVE_KIND_PREFIX,
  PRIMITIVE_BLOCK_SIZE,
} from '../app/geometry-service.ts';

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
const PRIMITIVE_PREFIX = PRIMITIVE_KIND_PREFIX;
const PRIMITIVE_COLORS: Record<string, string> = {
  __primitive_blue: '#3b6bf2',
  __primitive_stone: '#a8a8a8',
};
const PRIMITIVE_FALLBACK_COLOR = '#ff00ff';

// Preload every kind in the bundled-default registry at module load so
// the first scene paint renders without a flash. Kinds added later via
// catalog hydration are preloaded lazily inside `KindInstanceGroup`
// via `useGLTF`, which caches by URL.
for (const kind of validateWorldObjectKindCatalog(defaultCatalogJson).kinds) {
  useGLTF.preload(modelUrl(kind.gltfPath));
}

/**
 * Apply a transformation to a kind's resolved material — e.g. an
 * editor can dim, tint, or make transparent the cubes it renders.
 * The base material is the one `buildMaterialForKind` returns; the
 * override should return the material to actually use (typically a
 * `.clone()` of the base with mutated properties).
 */
export type MaterialOverride = (
  kindId: string,
  base: THREE.Material,
) => THREE.Material;

type ObjectInstancesProps =
  // Gameplay use: subscribe to a Store and follow its worldObjects.
  // Publishes the `__OFFICE_OBJECT_INSTANCES__` window marker that
  // gameplay regression tests assert on. `exclude` leaves out
  // instances drawn some other way, e.g. by a baked layout.
  | {
      store: Store;
      worldObjects?: undefined;
      exclude?: ExcludeInstance;
      materialOverride?: MaterialOverride;
    }
  // Editor use: render a static snapshot directly. No store
  // subscription, no window marker — editors mount their own
  // ObjectInstances per scene/room and don't need the gameplay
  // diagnostic.
  | { store?: undefined; worldObjects: WorldObjects; exclude?: undefined; materialOverride?: MaterialOverride };

/**
 * Renders a `WorldObjects` snapshot as one InstancedMesh per `kindId`.
 *
 * Two ways to feed it:
 *   - **Gameplay**: pass `store`. ObjectInstances subscribes and
 *     re-renders whenever `state.worldObjects` changes. Publishes
 *     `window.__OFFICE_OBJECT_INSTANCES__` for the e2e regression
 *     suite.
 *   - **Editor**: pass `worldObjects` directly. ObjectInstances
 *     renders the snapshot as-is; the editor owns when to recompute
 *     it. No window marker.
 *
 * In both modes the same `KindInstanceGroup` / `PrimitiveInstance
 * Group` does the per-kind rendering — the prop just decides where
 * the snapshot comes from. This keeps every mode (Debug, Mugshot,
 * Map, Room, Object preview) on a single rendering code path; the
 * difference between modes is composition above ObjectInstances,
 * not duplication of it.
 *
 * Subscribes to the live cube catalog so per-kind material overrides
 * (tint, opacity, roughness, metalness, emissive) and the per-kind
 * default scale propagate from the Object editor.
 *
 * Coords: each instance's `position` is integer voxel space; world
 * position = `position * voxelSize` (SDK field named `cubeSize` for back-compat).
 */
export function ObjectInstances(props: ObjectInstancesProps) {
  // The discriminated union guarantees exactly one of these is set.
  return props.worldObjects !== undefined ? (
    <ObjectInstancesView
      worldObjects={props.worldObjects}
      materialOverride={props.materialOverride}
    />
  ) : (
    <ObjectInstancesFromStore
      store={props.store}
      exclude={props.exclude}
      materialOverride={props.materialOverride}
    />
  );
}

interface FromStoreProps {
  store: Store;
  exclude?: ExcludeInstance;
  materialOverride?: MaterialOverride;
}

function ObjectInstancesFromStore({ store, exclude, materialOverride }: FromStoreProps) {
  const snapshot = useStoreWorldObjects(store, exclude);

  // Publish a render-marker on the window for regression tests.
  // If <ObjectInstances> is ever again forgotten in Scene.tsx (as
  // happened during the studio refactor), `__OFFICE_OBJECT_INSTANCES__`
  // is undefined and the e2e test "Map switch in Debug actually
  // renders the new cubes" fails fast with a clear message.
  //
  // The marker is store-only because:
  //   - Editors mount their own ObjectInstances per snapshot; the
  //     global window key would race between editor + (some future)
  //     simultaneously-mounted gameplay scene.
  //   - The gameplay regression tests already only run against
  //     Debug/Mugshot, which take this branch.
  return (
    <ObjectInstancesView
      worldObjects={snapshot}
      materialOverride={materialOverride}
      publishWindowMarker
    />
  );
}

interface ViewProps {
  worldObjects: WorldObjects;
  materialOverride?: MaterialOverride;
  publishWindowMarker?: boolean;
}

function ObjectInstancesView({
  worldObjects,
  materialOverride,
  publishWindowMarker,
}: ViewProps) {
  const kinds = useCatalog();
  const kindById = useMemo(() => {
    const m = new Map<string, WorldObjectKind>();
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
    for (const inst of worldObjects.instances) {
      let arr = byKind.get(inst.kindId);
      if (!arr) {
        arr = [];
        byKind.set(inst.kindId, arr);
      }
      arr.push(inst);
    }
    const out: Array<{ kind: WorldObjectKind; instances: ObjectInstance[] }> = [];
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
      out.push({ kind, instances });
    }
    return { usedKinds: out, usedPrimitives: primitives };
  }, [worldObjects, kindById]);

  useEffect(() => {
    if (!publishWindowMarker) return;
    const win = globalThis as unknown as {
      __OFFICE_OBJECT_INSTANCES__?: {
        storeCount: number;
        perKind: Array<{ kindId: string; count: number }>;
      };
    };
    win.__OFFICE_OBJECT_INSTANCES__ = {
      storeCount: worldObjects.instances.length,
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
  }, [worldObjects, usedKinds, usedPrimitives, publishWindowMarker]);

  return (
    <>
      {usedKinds.map(({ kind, instances }) => (
        <KindInstanceGroup
          key={kind.id}
          kind={kind}
          instances={instances}
          materialOverride={materialOverride}
        />
      ))}
      {usedPrimitives.map(({ kindId, color, instances }) => (
        <PrimitiveInstanceGroup
          key={kindId}
          kindId={kindId}
          color={color}
          instances={instances}
        />
      ))}
    </>
  );
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);

function setInstancePose(
  geometry: InstanceGeometryService,
  inst: ObjectInstance,
  pos: THREE.Vector3,
  quat: THREE.Quaternion,
): void {
  const { position, rotationY } = geometry.meshTransform(inst.position, inst.kindId, inst.yawDeg);
  pos.set(position[0], position[1], position[2]);
  quat.setFromAxisAngle(Y_AXIS, rotationY);
}

interface KindInstanceGroupProps {
  kind: WorldObjectKind;
  instances: ObjectInstance[];
  materialOverride?: MaterialOverride;
}

// TODO(task-01): kind.optimization is read but not yet acted on.
// A future PR should implement 'static-batch' (merge geometry) and
// 'frustum-cull' (set mesh.frustumCulled = true) paths here.
// Scaffolding per updated-prd.md "Out of Scope".

function KindInstanceGroup({
  kind,
  instances,
  materialOverride,
}: KindInstanceGroupProps) {
  const { geometry } = useApplication();
  const gltf = useGLTF(modelUrl(kind.gltfPath));
  const geom = useMemo(() => extractGeometryFromGltf(gltf.scene), [gltf.scene]);
  // Clone the GLTF material per kind so per-kind override edits are
  // isolated from any other <ObjectInstances> mount sharing the same
  // GLTF asset. The clone happens once per kind material-override
  // signature; in-place mutation of an existing clone is avoided so
  // React's effect doesn't fight the renderer's frame loop.
  const mat = useMemo(() => {
    const base = buildMaterialForKind(extractMaterialFromGltf(gltf.scene), kind);
    return materialOverride ? materialOverride(kind.id, base) : base;
  }, [
    gltf.scene,
    kind.id,
    kind.tint,
    kind.opacity,
    kind.roughness,
    kind.metalness,
    kind.emissive,
    kind.emissiveIntensity,
    materialOverride,
  ]);

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
    // Scale is exactly `kind.scale` — no seam-overlap fudge.
    const s = kind.scale;
    const scale = new THREE.Vector3(s, s, s);
    for (let i = 0; i < instances.length; i++) {
      setInstancePose(geometry, instances[i], pos, quat);
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
    // object positions.
  }, [instances, kind.scale, mat, geometry]);

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
}: PrimitiveInstanceGroupProps) {
  const { geometry } = useApplication();
  const geom = useMemo(
    () =>
      new THREE.BoxGeometry(
        PRIMITIVE_BLOCK_SIZE,
        PRIMITIVE_BLOCK_SIZE,
        PRIMITIVE_BLOCK_SIZE,
      ),
    [],
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
      setInstancePose(geometry, instances[i], pos, quat);
      m.compose(pos, quat, scale);
      mesh.setMatrixAt(i, m);
    }
    mesh.count = instances.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [instances, mat, geometry]);

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

