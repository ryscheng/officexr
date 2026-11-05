/**
 * `<BakedLayout>` — renderer primitive for a pre-baked layout GLB.
 *
 * Loads the GLB at `gltfPath` via drei's `useGLTF` inside a `<Suspense>`
 * boundary.  When a `layoutName` is provided it watches the `BakeRegistry`
 * so the component re-renders when a new bake is published (cache-busts
 * the drei URL by appending `?v=<version>`).
 *
 * CLAUDE.md guardrails obeyed:
 * - No `useRef + setStateSync` mirror pair.  The bake-version state is
 *   tracked via a plain `useState` driven by the registry `subscribe`
 *   callback — one place reads, one place writes.
 * - `three` is allowed in renderer files.
 */

import React, {
  Suspense,
  useState,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { useLoader } from '@react-three/fiber';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { getVersion, subscribe } from '../app/bake-registry.ts';
import { ResetKeyErrorBoundary } from './ResetKeyErrorBoundary.tsx';

export { ResetKeyErrorBoundary as BakedLayoutErrorBoundary };

/**
 * Material override for layout meshes.  Receives the existing material
 * and returns a replacement.  Unlike `ObjectInstances.MaterialOverride`,
 * layout meshes carry no `kindId` — the override covers the raw material.
 */
export type LayoutMaterialOverride = (material: THREE.Material) => THREE.Material;

// ---------------------------------------------------------------------------
// Inner component (inside Suspense)
// ---------------------------------------------------------------------------

interface BakedLayoutMeshProps {
  effectiveUrl: string;
  materialOverride?: LayoutMaterialOverride;
}

/**
 * GLTF loader that sends cookies with every request. Its own constructor
 * gives it a separate r3f loader instance and cache from `useGLTF`'s shared
 * one, so credentialed loads never leak into CDN model loads.
 */
export class CredentialedGLTFLoader extends GLTFLoader {
  constructor() {
    super();
    this.withCredentials = true;
    this.crossOrigin = 'use-credentials';
  }
}

let dracoLoader: DRACOLoader | null = null;

// Mirrors drei's `useGLTF` extensions (its default DRACO decoder path + meshopt) so both paths parse alike.
function credentialedExtensions(loader: GLTFLoader): void {
  dracoLoader ??= new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.5/');
  loader.setDRACOLoader(dracoLoader);
  loader.setMeshoptDecoder(MeshoptDecoder);
}

function BakedLayoutMesh({ effectiveUrl, materialOverride }: BakedLayoutMeshProps) {
  const gltf = useGLTF(effectiveUrl);
  return <BakedLayoutScene source={gltf.scene} materialOverride={materialOverride} />;
}

function CredentialedBakedLayoutMesh({ effectiveUrl, materialOverride }: BakedLayoutMeshProps) {
  const gltf = useLoader(CredentialedGLTFLoader, effectiveUrl, credentialedExtensions);
  return <BakedLayoutScene source={gltf.scene} materialOverride={materialOverride} />;
}

function BakedLayoutScene({
  source,
  materialOverride,
}: {
  source: THREE.Object3D;
  materialOverride?: LayoutMaterialOverride;
}) {
  // The loader caches one scene per URL; a three.js object has a single
  // parent, so each mount draws its own clone (geometry and materials
  // stay shared).
  const scene = useMemo(() => source.clone(true), [source]);

  // Make the baked layout participate in the shadow pipeline the same
  // way `<ObjectInstances>` does for per-instance kinds. Without this,
  // structural walls/floors loaded from a baked GLB don't cast or
  // receive shadows — characters end up looking shadow-less in Debug
  // mode the moment a map's structural geometry moves into a bake.
  useEffect(() => {
    scene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const m = child as THREE.Mesh;
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
  }, [scene]);

  // If a material override is provided, apply it to every mesh in the scene.
  useEffect(() => {
    if (!materialOverride) return;
    scene.traverse((child) => {
      if ('material' in child) {
        const mesh = child as { material: THREE.Material };
        // DIP note: `materialOverride` is injected from the editor layer so
        // the renderer doesn't know about editor-specific material variants.
        mesh.material = materialOverride(mesh.material);
      }
    });
  }, [scene, materialOverride]);

  return <primitive object={scene} />;
}

// ---------------------------------------------------------------------------
// BakedLayout (exported)
// ---------------------------------------------------------------------------

export interface BakedLayoutProps {
  /** URL to the pre-baked GLB, e.g. `/api/baked-layouts/myLayout`. */
  gltfPath: string;
  /**
   * Layout name for registry integration.  When provided:
   * - The component subscribes to `BakeRegistry.subscribe` and
   *   re-renders (cache-busts) when a new bake is published.
   * - If the initial load fails (e.g. 404 — no bake on disk yet), the
   *   built-in error boundary catches the error so the rest of the
   *   canvas keeps rendering. Pair with `onLoadError` to surface a
   *   "still baking" hint in the editor UI.
   */
  layoutName?: string;
  /** React node rendered while the GLB is loading. Defaults to null. */
  fallback?: ReactNode;
  /**
   * Optional editor overlay: a function that transforms each mesh's
   * material (e.g. to apply transparency or tinting for ghost mode).
   * Unlike `ObjectInstances.MaterialOverride`, layout meshes carry no
   * kindId — the override only receives the raw material.
   */
  materialOverride?: LayoutMaterialOverride;
  /**
   * Called when the underlying GLB load throws (e.g. 404 because the
   * layout has not been baked yet). The boundary swallows the error so
   * the canvas keeps rendering; the editor surfaces a UI hint based on
   * this callback. Re-armed when `layoutName` changes.
   */
  onLoadError?: (err: Error) => void;
  /** Send cookies with the GLB request, for a `gltfPath` on a cross-origin session-gated server. */
  withCredentials?: boolean;
}

/**
 * Renders a pre-baked layout GLB. Wraps `useGLTF` in `<Suspense>` and
 * subscribes to `BakeRegistry` to cache-bust when a new bake lands.
 *
 * No `useRef + setStateSync` mirror pairs — state is held in a single
 * `useState(version)` driven by the registry subscribe callback.
 */
export function BakedLayout({
  gltfPath,
  layoutName,
  fallback = null,
  materialOverride,
  onLoadError,
  withCredentials = false,
}: BakedLayoutProps) {
  // Track the registry version so we can append `?v=<N>` to the URL,
  // causing drei to re-fetch after a new bake is published.
  const [version, setVersion] = useState(
    () => (layoutName ? getVersion(layoutName) : 0),
  );

  useEffect(() => {
    if (!layoutName) return;

    // Sync immediately in case a bake completed between render and effect.
    const current = getVersion(layoutName);
    if (current !== version) {
      setVersion(current);
    }

    const unsub = subscribe((name, state) => {
      if (name !== layoutName) return;
      if (state === 'settled') {
        setVersion(getVersion(name));
      }
    });
    return unsub;
    // Only re-subscribe when layoutName changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutName]);

  // Append a cache-busting query parameter when a bake has been recorded.
  // Version 0 means "never baked in this session"; skip the `?v=` suffix so
  // we get a clean URL (avoids a 404 for a newly-added layout).
  const effectiveUrl = version > 0 ? `${gltfPath}?v=${version}` : gltfPath;
  const Mesh = withCredentials ? CredentialedBakedLayoutMesh : BakedLayoutMesh;

  return (
    <ResetKeyErrorBoundary
      resetKey={layoutName ?? gltfPath}
      onError={onLoadError}
      fallback={fallback}
    >
      <Suspense fallback={fallback}>
        <Mesh
          effectiveUrl={effectiveUrl}
          materialOverride={materialOverride}
        />
      </Suspense>
    </ResetKeyErrorBoundary>
  );
}
