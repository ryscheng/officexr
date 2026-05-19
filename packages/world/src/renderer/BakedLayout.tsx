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
  Component,
  Suspense,
  useState,
  useEffect,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import * as THREE from 'three';
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

  // Make the baked layout participate in the shadow pipeline the same
  // way `<ObjectInstances>` does for per-instance kinds. Without this,
  // structural walls/floors loaded from a baked GLB don't cast or
  // receive shadows — characters end up looking shadow-less in Debug
  // mode the moment a map's structural geometry moves into a bake.
  // The patch runs as a render-time traversal (not a mutation of the
  // cached GLTF asset) so it doesn't leak into other consumers.
  useEffect(() => {
    gltf.scene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const m = child as THREE.Mesh;
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
  }, [gltf]);

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
// Error boundary — keeps a missing/failing GLB from killing the canvas
// ---------------------------------------------------------------------------

interface BakedLayoutErrorBoundaryProps {
  /** The layout name being loaded. Changing this resets the boundary
   *  so a fresh bake gets a fresh load attempt. */
  resetKey: string | undefined;
  /** Called when the load fails (and again when a retry fails). Lets
   *  the editor surface a "bake not ready" message in the inspector. */
  onError?: (err: Error) => void;
  /** Rendered while the loader is throwing. Defaults to nothing so the
   *  rest of the scene remains visible. */
  fallback?: ReactNode;
  children: ReactNode;
}

interface BakedLayoutErrorBoundaryState {
  /** Last `resetKey` we caught an error under. When the live resetKey
   *  diverges from this one the boundary clears itself, giving the
   *  new layout name a fresh load attempt. */
  failedFor: string | undefined;
}

/**
 * Class-based error boundary scoped to a single baked-GLB consumer
 * (`<BakedLayout>` or `<BakedLayoutColliders>`). Catches the `useGLTF`
 * 404 / parse-failure that drei lets propagate through Suspense,
 * displays `fallback` instead of unwinding the whole R3F canvas, and
 * re-arms when the parent passes a new layout name.
 *
 * Class component is necessary — React's error-boundary API is only
 * available to class components. Everything else in this file stays
 * functional.
 */
export class BakedLayoutErrorBoundary extends Component<
  BakedLayoutErrorBoundaryProps,
  BakedLayoutErrorBoundaryState
> {
  state: BakedLayoutErrorBoundaryState = { failedFor: undefined };

  static getDerivedStateFromError(): Partial<BakedLayoutErrorBoundaryState> {
    // We don't know the resetKey here (statics can't see props); store
    // a sentinel and let componentDidCatch fill in the real value.
    return { failedFor: '__pending__' };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    this.setState({ failedFor: this.props.resetKey });
    this.props.onError?.(error);
  }

  componentDidUpdate(prevProps: BakedLayoutErrorBoundaryProps): void {
    // New layout name? Clear the boundary so the next render gets a
    // fresh shot at loading it.
    if (
      this.state.failedFor !== undefined &&
      prevProps.resetKey !== this.props.resetKey
    ) {
      this.setState({ failedFor: undefined });
    }
  }

  render(): ReactNode {
    if (this.state.failedFor !== undefined) {
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
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
    <BakedLayoutErrorBoundary
      resetKey={layoutName ?? gltfPath}
      onError={onLoadError}
      fallback={fallback}
    >
      <Suspense fallback={fallback}>
        <BakedLayoutMesh
          effectiveUrl={effectiveUrl}
          materialOverride={materialOverride}
        />
      </Suspense>
    </BakedLayoutErrorBoundary>
  );
}
