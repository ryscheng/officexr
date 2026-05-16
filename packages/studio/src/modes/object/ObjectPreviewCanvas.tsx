import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import {
  DEFAULT_EDITOR_LIGHTING,
  EditorCamera,
  EndlessGrid,
  LightingRig,
  buildMaterialForKind,
  extractGeometryFromGltf,
  extractMaterialFromGltf,
} from '@officexr/world/renderer';
import type { CubeKindEntry } from '@officexr/world';

// Editor-tuned lighting for the Object preview. Bright neutral fill
// + a punchy key light so material overrides (tint, roughness,
// emissive) read clearly on the spinning preview cube.
const OBJECT_PREVIEW_LIGHTING = {
  ...DEFAULT_EDITOR_LIGHTING,
  sunPosition: [6, 12, 6] as [number, number, number],
  sunIntensity: 1.4,
  ambientFillIntensity: 0.55,
};

interface ObjectPreviewCanvasProps {
  kind: CubeKindEntry | null;
}

/**
 * Minimal R3F canvas for the Object editor. Shows ONE instance of
 * the selected kind, slowly spinning on its Y axis on top of an
 * endless grid. The mesh re-renders whenever the kind's material
 * override fields change (the Object editor's Leva sliders push
 * those edits via `useObjectCatalog.applyPatch`).
 *
 * Camera is a right-drag orbit around the cube; scroll dollies.
 * No keyboard nav.
 *
 * When the URL contains `?thumbnailMode=true`, the canvas renders
 * with a transparent background (no <color> background, no grid)
 * so Playwright can screenshot it as a 128×128 transparent PNG.
 * This is used by `pnpm gen:thumbnails`.
 */
export function ObjectPreviewCanvas({ kind }: ObjectPreviewCanvasProps) {
  // Check for thumbnail mode via URL param — used by the gen:thumbnails script.
  const thumbnailMode =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('thumbnailMode') === 'true';

  const canvasStyle: React.CSSProperties = thumbnailMode
    ? { width: 128, height: 128, display: 'block' }
    : { width: '100%', height: '100%', display: 'block' };

  return (
    <Canvas
      style={canvasStyle}
      shadows={false}
      gl={{ alpha: thumbnailMode, antialias: true }}
    >
      <EditorCamera
        position={[2.5, 2, 2.5]}
        target={[0, 0.5, 0]}
        fov={45}
        minDistance={1.5}
        maxDistance={40}
      />
      <LightingRig lighting={OBJECT_PREVIEW_LIGHTING} />
      {!thumbnailMode && <color attach="background" args={['#0a0a0a']} />}
      {!thumbnailMode && <EndlessGrid />}
      {kind ? <KindPreview kind={kind} /> : null}
    </Canvas>
  );
}

function KindPreview({ kind }: { kind: CubeKindEntry }) {
  const { gl } = useThree();
  const gltf = useGLTF(kind.gltfPath);
  const geom = useMemo(() => extractGeometryFromGltf(gltf.scene), [gltf.scene]);
  // Rebuild the material whenever an override field changes so a
  // Leva tweak shows up live.
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
  // Slow Y-axis spin so the user can see the cube's faces without
  // dragging the camera — but pause it while the cursor is over the
  // canvas so the user can inspect a static frame (e.g. while
  // comparing visuals against the physics collider top).
  const meshRef = useRef<THREE.Mesh>(null);
  const hoveredRef = useRef(false);
  useEffect(() => {
    const c = gl.domElement;
    const enter = () => {
      hoveredRef.current = true;
    };
    const leave = () => {
      hoveredRef.current = false;
    };
    c.addEventListener('pointerenter', enter);
    c.addEventListener('pointerleave', leave);
    return () => {
      c.removeEventListener('pointerenter', enter);
      c.removeEventListener('pointerleave', leave);
    };
  }, [gl]);
  useFrame((_, dt) => {
    if (!meshRef.current) return;
    if (hoveredRef.current) return;
    meshRef.current.rotation.y += dt * 0.4;
  });
  const s = kind.scale;
  return (
    <mesh
      ref={meshRef}
      geometry={geom}
      material={mat}
      position={[0, 0.5 * s, 0]}
      scale={[s, s, s]}
    />
  );
}

