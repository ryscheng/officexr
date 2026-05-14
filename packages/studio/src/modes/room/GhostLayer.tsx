import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { getCubeKind } from '@officexr/world';
import {
  extractGeometryFromGltf,
  extractMaterialFromGltf,
} from '@officexr/world/renderer';

/**
 * Render mode for a ghost cube:
 *   - `solid`: 50% transparent, static. Used by the Add tool and
 *     by the Tile tool's pre-click + in-flight previews.
 *   - `pulse`: 25%–75% transparent oscillation. Used by the Delete
 *     tool to denote "click will delete this". The PulseDriver
 *     mounts only when at least one pulse-mode ghost exists.
 *   - `selected`: 25% opaque, saturated swatch color. Used by the
 *     Select tool's per-instance overlay so selected cubes read as
 *     clearly highlighted in addition to the per-cluster wireframe.
 */
export type GhostMode = 'solid' | 'pulse' | 'selected';

export interface GhostSpec {
  mode: GhostMode;
  kindId: string;
  voxel: [number, number, number];
}

interface GhostLayerProps {
  ghosts: readonly GhostSpec[];
  cubeSize: number;
}

/**
 * Renders a parallel set of `<instancedMesh>`es alongside the opaque
 * `CubesLayer`. Each (mode, kindId) pair gets its own InstancedMesh
 * so the cloned-transparent material isolates from the opaque
 * material the renderer uses elsewhere.
 *
 * Ghost meshes opt out of the snap raycaster via `mesh.layers.set(31)`
 * so the Add/Tile tools never snap to their own ghost preview.
 */
export function GhostLayer({ ghosts, cubeSize }: GhostLayerProps) {
  // Group ghosts by (mode, kindId).
  const groups = useMemo(() => {
    const m = new Map<string, { mode: GhostMode; kindId: string; voxels: [number, number, number][] }>();
    for (const g of ghosts) {
      const key = `${g.mode}:${g.kindId}`;
      let bucket = m.get(key);
      if (!bucket) {
        bucket = { mode: g.mode, kindId: g.kindId, voxels: [] };
        m.set(key, bucket);
      }
      bucket.voxels.push([...g.voxel]);
    }
    return Array.from(m.values());
  }, [ghosts]);

  const hasPulse = groups.some((g) => g.mode === 'pulse');

  // One shared "pulse opacity" ref that every pulse material reads
  // each frame. Driver mounted exactly when needed.
  const pulseOpacityRef = useRef<number>(0.5);
  return (
    <>
      {groups.map((g) => (
        <GhostMeshForGroup
          key={`${g.mode}:${g.kindId}`}
          mode={g.mode}
          kindId={g.kindId}
          voxels={g.voxels}
          cubeSize={cubeSize}
          pulseOpacityRef={pulseOpacityRef}
        />
      ))}
      {hasPulse ? <PulseDriver opacityRef={pulseOpacityRef} /> : null}
    </>
  );
}

const SEAM_OVERLAP = 1.05;

interface GhostMeshForGroupProps {
  mode: GhostMode;
  kindId: string;
  voxels: [number, number, number][];
  cubeSize: number;
  pulseOpacityRef: React.MutableRefObject<number>;
}

function GhostMeshForGroup({
  mode,
  kindId,
  voxels,
  cubeSize,
  pulseOpacityRef,
}: GhostMeshForGroupProps) {
  const kind = getCubeKind(kindId);
  // useGLTF unconditionally so the hook order is stable even when the
  // kind is unknown (we still render nothing in that case below).
  const gltf = useGLTF(kind?.gltfPath ?? '/models/blocks/colored_block_blue.gltf');

  const geom = useMemo(() => extractGeometryFromGltf(gltf.scene), [gltf.scene]);
  const mat = useMemo(() => {
    if (mode === 'selected') {
      // Unlit + saturated swatch + 75% transparent. Replaces the
      // GLTF's PBR material so the selection reads as a flat,
      // vivid colour regardless of the scene's lighting.
      return new THREE.MeshBasicMaterial({
        color: kind ? kind.swatch : '#fde68a',
        transparent: true,
        opacity: 0.80,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
    }
    const base = (extractMaterialFromGltf(gltf.scene) as THREE.MeshStandardMaterial).clone();
    base.transparent = true;
    // Solid ghosts use a constant 0.5; pulse ghosts get overwritten
    // every frame by PulseDriver via the shared opacityRef.
    base.opacity = 0.5;
    base.depthWrite = false;
    base.side = THREE.DoubleSide;
    return base;
  }, [gltf.scene, mode, kind]);

  const meshRef = useRef<THREE.InstancedMesh>(null);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    // Make the mesh non-pickable so the snap raycaster never snaps to
    // its own ghost preview. We do NOT use `mesh.layers.set(N)` for
    // this because that would also opt the mesh OUT of rendering —
    // the camera only renders meshes on the layers it has enabled
    // (default layer 0). A no-op `raycast` keeps the mesh visible
    // while making it transparent to picking.
    mesh.raycast = () => {};
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(SEAM_OVERLAP, SEAM_OVERLAP, SEAM_OVERLAP);
    for (let i = 0; i < voxels.length; i++) {
      const v = voxels[i];
      p.set(v[0] * cubeSize, v[1] * cubeSize + cubeSize / 2, v[2] * cubeSize);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.count = voxels.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [voxels, cubeSize]);

  // Drive opacity from the shared pulse ref each frame when in pulse
  // mode. Solid ghosts keep their constant 0.5 — no per-frame work.
  useFrame(() => {
    if (mode !== 'pulse') return;
    mat.opacity = pulseOpacityRef.current;
  });

  if (!kind || voxels.length === 0) return null;
  const capacity = Math.max(1, voxels.length);
  return (
    <instancedMesh
      ref={meshRef}
      args={[geom, mat, capacity]}
      castShadow={false}
      receiveShadow={false}
      renderOrder={1}
    />
  );
}

interface PulseDriverProps {
  opacityRef: React.MutableRefObject<number>;
}

/**
 * Drives the shared pulse-mode opacity ref. One driver fed by every
 * pulse ghost in the scene — opacity is one shared value, not per
 * mesh, so the pulse stays in sync across a whole group hover.
 */
function PulseDriver({ opacityRef }: PulseDriverProps) {
  useFrame(({ clock }) => {
    // 0.25 → 0.75 sinusoid at 4 rad/s (period ~1.5s). Centered at
    // 0.5 so a static pulse-mode glow is visible even mid-animation.
    opacityRef.current = 0.5 + 0.25 * Math.sin(clock.elapsedTime * 4);
  });
  return null;
}
