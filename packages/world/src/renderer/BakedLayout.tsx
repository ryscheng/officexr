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

import React, { Suspense, useState, useEffect, type ReactNode } from 'react';
import type * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { getVersion, subscribe } from '../app/bake-registry.ts';

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

function BakedLayoutMesh({ effectiveUrl, materialOverride }: BakedLayoutMeshProps) {
  const gltf = useGLTF(effectiveUrl);

  // If a material override is provided, apply it to every mesh in the scene.
  // This is intentionally a "render-time patch" (not mutating the GLTF asset)
  // so the override is ephemeral and doesn't bleed into other consumers.
  useEffect(() => {
    if (!materialOverride) return;
    gltf.scene.traverse((child) => {
      if ('material' in child) {
        const mesh = child as { material: THREE.Material };
        // DIP note: `materialOverride` is injected from the editor layer so
        // the renderer doesn't know about editor-specific material variants.
        mesh.material = materialOverride(mesh.material);
      }
    });
  }, [gltf, materialOverride]);

  return <primitive object={gltf.scene} />;
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
   * - If the initial load fails (e.g. 404 — no bake on disk yet), an
   *   error boundary higher up can catch and trigger an initial bake.
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

  return (
    <Suspense fallback={fallback}>
      <BakedLayoutMesh
        effectiveUrl={effectiveUrl}
        materialOverride={materialOverride}
      />
    </Suspense>
  );
}
