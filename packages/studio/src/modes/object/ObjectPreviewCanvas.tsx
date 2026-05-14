import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { EndlessGrid } from '@officexr/world/renderer';
import {
  buildMaterialForKind,
  extractGeometryFromGltf,
  extractMaterialFromGltf,
} from '@officexr/world/renderer';
import type { CubeKindEntry } from '@officexr/world';

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
 */
export function ObjectPreviewCanvas({ kind }: ObjectPreviewCanvasProps) {
  return (
    <Canvas
      camera={{ position: [2.5, 2, 2.5], fov: 45, near: 0.1, far: 200 }}
      style={{ width: '100%', height: '100%', display: 'block' }}
      shadows={false}
    >
      <ambientLight intensity={0.55} />
      <directionalLight position={[6, 12, 6]} intensity={1.4} />
      <color attach="background" args={['#0a0a0a']} />
      <EndlessGrid />
      <OrbitCamera />
      {kind ? <KindPreview kind={kind} /> : null}
    </Canvas>
  );
}

function KindPreview({ kind }: { kind: CubeKindEntry }) {
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
  // dragging the camera. Stop the spin while the user is interacting
  // would be nice but isn't critical.
  const meshRef = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (meshRef.current) meshRef.current.rotation.y += dt * 0.4;
  });
  // SEAM_OVERLAP isn't needed here — there's only one cube on screen
  // so we don't have to hide the seam between adjacent voxels.
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

function OrbitCamera() {
  const { camera, gl } = useThree();
  const persp = camera as THREE.PerspectiveCamera;

  const orbit = useRef({
    azimuth: 0.6,
    elevation: 0.5,
    distance: 4,
  });
  const drag = useRef({ active: false, lastX: 0, lastY: 0 });
  const target = useRef(new THREE.Vector3(0, 0.5, 0));

  useEffect(() => {
    const canvas = gl.domElement;
    const onPointerDown = (e: PointerEvent) => {
      // Right-drag orbits; matches the Room editor's convention.
      if (e.button !== 2) return;
      drag.current = { active: true, lastX: e.clientX, lastY: e.clientY };
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!drag.current.active) return;
      const dx = e.clientX - drag.current.lastX;
      const dy = e.clientY - drag.current.lastY;
      drag.current.lastX = e.clientX;
      drag.current.lastY = e.clientY;
      const sens = 0.006;
      orbit.current.azimuth -= dx * sens;
      orbit.current.elevation = THREE.MathUtils.clamp(
        orbit.current.elevation - dy * sens,
        -Math.PI / 2 + 0.05,
        Math.PI / 2 - 0.05,
      );
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 2) return;
      drag.current.active = false;
    };
    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(e.deltaY * 0.001);
      orbit.current.distance = THREE.MathUtils.clamp(
        orbit.current.distance * factor,
        1.5,
        40,
      );
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      drag.current.active = false;
    };
  }, [gl]);

  useFrame(() => {
    const { azimuth, elevation, distance } = orbit.current;
    const t = target.current;
    const cosE = Math.cos(elevation);
    persp.position.set(
      t.x + distance * cosE * Math.sin(azimuth),
      t.y + distance * Math.sin(elevation),
      t.z + distance * cosE * Math.cos(azimuth),
    );
    persp.lookAt(t);
  });

  return null;
}
