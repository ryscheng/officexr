import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import {
  CUBE_KINDS,
  FREE_FLY_DEFAULTS,
  type CubeKindDef,
} from '@officexr/world';
import { EndlessGrid } from '@officexr/world/renderer';
import type { ObjectInstance, WorldObjects } from '@officexr/sdk';
import type { Tool } from './tools.ts';

interface SceneEditorCanvasProps {
  /** The compiled scene snapshot to render. */
  compiled: WorldObjects;
  /** Currently-selected source command ids (multi-select). Every
   * instance whose `sourceCommandId` is in this set gets the
   * highlight tint so the user can see what they're editing. */
  selection: ReadonlySet<string>;
  /** Active editor tool — determines what a left-click does. */
  tool: Tool;
  /** Cube kind staged for the Add tool. */
  stagedKindId: string | null;
  /** Click on an empty cell (no cube hit) with the Add tool active —
   * places a cube of the staged kind at the picked floor position.
   * Coords are integer voxels. */
  onPlaceAt: (position: [number, number, number]) => void;
  /** Click on an existing cube with the Select tool active. `modKey`
   * is true when Ctrl or Cmd was held — caller maps that to toggle
   * vs. replace semantics. */
  onSelectInstance: (commandId: string, modKey: boolean) => void;
  /** Click on EMPTY floor with the Select tool — deselects. The
   * canvas only knows that the click missed every cube; the parent
   * decides whether that means "deselect" or some other action. */
  onClickEmpty: () => void;
}

/**
 * Standalone R3F canvas for the Scenes editor. Owns its own free-fly
 * camera + raycast layer; doesn't share anything with the multiplayer
 * Scene used by the Debug app.
 *
 * Controls:
 *   - WASD/QE/Shift: free-fly translation (in the camera's local
 *     basis; QE is up/down).
 *   - Left-button drag (no pointer lock): rotate the view. If the
 *     drag started on a cube, orbit around that cube; otherwise
 *     rotate around the camera position.
 *   - Scroll wheel: dolly along the camera's forward vector.
 *   - Click (no drag) on a cube: select; the editor's inspector
 *     activates with that command.
 *   - Click on a cube's face when it's already selected: extrude that
 *     command in the face's direction by `extrudeCount`.
 *   - Click on the floor (no cube hit) with a `stagedKindId`: place a
 *     new cube at that voxel.
 */
export function SceneEditorCanvas(props: SceneEditorCanvasProps) {
  return (
    <Canvas
      camera={{
        position: FREE_FLY_DEFAULTS.position,
        fov: FREE_FLY_DEFAULTS.fov,
        near: 0.1,
        far: 2000,
      }}
      style={{ width: '100%', height: '100%', display: 'block' }}
      shadows={false}
    >
      <ambientLight intensity={0.6} />
      <directionalLight position={[20, 40, 20]} intensity={1.2} />
      <color attach="background" args={['#0a0a0a']} />
      <EndlessGrid />
      <FreeFlyCamera />
      <CubesLayer
        instances={props.compiled.instances}
        cubeSize={props.compiled.cubeSize}
        selection={props.selection}
        tool={props.tool}
        onSelectInstance={props.onSelectInstance}
      />
      <FloorPicker
        cubeSize={props.compiled.cubeSize}
        tool={props.tool}
        stagedKindId={props.stagedKindId}
        onPlaceAt={props.onPlaceAt}
        onClickEmpty={props.onClickEmpty}
      />
    </Canvas>
  );
}

// --- Free-fly camera (canvas-local) -----------------------------

function FreeFlyCamera() {
  const { camera, gl } = useThree();
  const persp = camera as THREE.PerspectiveCamera;

  const keys = useRef(new Set<string>());
  const pos = useRef(new THREE.Vector3(...FREE_FLY_DEFAULTS.position));
  const yaw = useRef(FREE_FLY_DEFAULTS.yaw);
  const pitch = useRef(FREE_FLY_DEFAULTS.pitch);
  const drag = useRef<{
    active: boolean;
    moved: boolean;
    lastX: number;
    lastY: number;
    orbitAnchor: THREE.Vector3 | null;
  }>({ active: false, moved: false, lastX: 0, lastY: 0, orbitAnchor: null });

  useEffect(() => {
    const canvas = gl.domElement;

    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      keys.current.add(e.code.toLowerCase());
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keys.current.delete(e.code.toLowerCase());
    };

    const onPointerDown = (e: PointerEvent) => {
      // Right-click drag = camera rotate. Left-click is reserved for
      // tool actions (select / add / extrude) which are handled by
      // R3F's own pointer-event system on the meshes themselves.
      if (e.button !== 2) return;
      drag.current = {
        active: true,
        moved: false,
        lastX: e.clientX,
        lastY: e.clientY,
        orbitAnchor: null,
      };
    };
    const onPointerMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d.active) return;
      const dx = e.clientX - d.lastX;
      const dy = e.clientY - d.lastY;
      d.lastX = e.clientX;
      d.lastY = e.clientY;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) d.moved = true;
      const sens = FREE_FLY_DEFAULTS.rotateSensitivity;
      yaw.current -= dx * sens;
      pitch.current = THREE.MathUtils.clamp(
        pitch.current - dy * sens,
        -1.4,
        1.4,
      );
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 2) return;
      drag.current.active = false;
    };
    // Suppress the browser context menu so right-click drag feels
    // native instead of summoning the OS menu mid-rotate.
    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const fwd = forwardVector(yaw.current, pitch.current);
      const step =
        -Math.sign(e.deltaY) *
        FREE_FLY_DEFAULTS.dollySensitivity *
        Math.min(8, Math.max(1, Math.abs(e.deltaY) / 50));
      pos.current.addScaledVector(fwd, step);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      keys.current.clear();
      drag.current.active = false;
    };
  }, [gl]);

  useFrame((_, dtSec) => {
    const k = keys.current;
    const speedBase = FREE_FLY_DEFAULTS.moveSpeed;
    const speed =
      speedBase *
      (k.has('shiftleft') || k.has('shiftright')
        ? FREE_FLY_DEFAULTS.shiftMultiplier
        : 1);
    const step = speed * dtSec;
    const fwd = forwardVector(yaw.current, pitch.current);
    const right = new THREE.Vector3(Math.cos(yaw.current), 0, -Math.sin(yaw.current));
    if (k.has('keyw')) pos.current.addScaledVector(fwd, step);
    if (k.has('keys')) pos.current.addScaledVector(fwd, -step);
    if (k.has('keyd')) pos.current.addScaledVector(right, step);
    if (k.has('keya')) pos.current.addScaledVector(right, -step);
    if (k.has('keye') || k.has('space')) pos.current.y += step;
    if (k.has('keyq') || k.has('controlleft') || k.has('controlright'))
      pos.current.y -= step;
    persp.position.copy(pos.current);
    const target = new THREE.Vector3()
      .copy(pos.current)
      .add(forwardVector(yaw.current, pitch.current));
    persp.lookAt(target);
  });

  return null;
}

function forwardVector(yaw: number, pitch: number): THREE.Vector3 {
  return new THREE.Vector3(
    -Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch),
  );
}

// --- Cubes layer (one InstancedMesh per kind, with picking) ------

interface CubesLayerProps {
  instances: ObjectInstance[];
  cubeSize: number;
  selection: ReadonlySet<string>;
  tool: Tool;
  onSelectInstance: (commandId: string, modKey: boolean) => void;
}

function CubesLayer(props: CubesLayerProps) {
  const byKind = useMemo(() => {
    const m = new Map<string, ObjectInstance[]>();
    for (const inst of props.instances) {
      let arr = m.get(inst.kindId);
      if (!arr) {
        arr = [];
        m.set(inst.kindId, arr);
      }
      arr.push(inst);
    }
    return m;
  }, [props.instances]);

  return (
    <>
      {CUBE_KINDS.map((kind) => (
        <KindGroup
          key={kind.id}
          kind={kind}
          instances={byKind.get(kind.id) ?? []}
          cubeSize={props.cubeSize}
          selection={props.selection}
          tool={props.tool}
          onSelectInstance={props.onSelectInstance}
        />
      ))}
    </>
  );
}

interface KindGroupProps {
  kind: CubeKindDef;
  instances: ObjectInstance[];
  cubeSize: number;
  selection: ReadonlySet<string>;
  tool: Tool;
  onSelectInstance: (commandId: string, modKey: boolean) => void;
}

function KindGroup({
  kind,
  instances,
  cubeSize,
  selection,
  tool,
  onSelectInstance,
}: KindGroupProps) {
  const gltf = useGLTF(kind.gltfPath);
  const geom = useMemo(() => extractGeometry(gltf.scene), [gltf.scene]);
  const mat = useMemo(() => {
    const m = (extractMaterial(gltf.scene) as THREE.MeshStandardMaterial).clone();
    return m;
  }, [gltf.scene]);

  const meshRef = useRef<THREE.InstancedMesh>(null);
  const capacity = Math.max(1, instances.length);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const baseScale = 1.05;
    const tint = new THREE.Color(1, 1, 1);
    const sel = new THREE.Color('#fde68a');
    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i];
      p.set(
        inst.position[0] * cubeSize,
        inst.position[1] * cubeSize + cubeSize / 2,
        inst.position[2] * cubeSize,
      );
      m.compose(p, q, new THREE.Vector3(baseScale, baseScale, baseScale));
      mesh.setMatrixAt(i, m);
      const isSelected = selection.has(inst.sourceCommandId);
      mesh.setColorAt(i, isSelected ? sel : tint);
    }
    mesh.count = instances.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [instances, cubeSize, selection]);

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    // Only respond to LEFT-click for the Select tool. Right-click is
    // owned by the free-fly camera; the Add tool ignores cube hits
    // (you can't stack new cubes on existing ones via clicks).
    if (e.button !== 0) return;
    if (tool !== 'select') return;
    e.stopPropagation();
    const instanceIdx = e.instanceId;
    if (instanceIdx === undefined) return;
    const inst = instances[instanceIdx];
    if (!inst) return;
    // Track drag distance — even with right-click camera, a misfire
    // left-drag shouldn't fire select on release.
    const startX = e.clientX;
    const startY = e.clientY;
    const modKey = e.ctrlKey || e.metaKey;
    let moved = false;
    const onMove = (m: PointerEvent) => {
      if (
        Math.abs(m.clientX - startX) > 4 ||
        Math.abs(m.clientY - startY) > 4
      ) {
        moved = true;
      }
    };
    const onUp = (u: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (moved || u.button !== 0) return;
      onSelectInstance(inst.sourceCommandId, modKey);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <instancedMesh
      ref={meshRef}
      args={[geom, mat, capacity]}
      castShadow={false}
      receiveShadow={false}
      onPointerDown={handlePointerDown}
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

// --- Floor picker (place-on-empty when Add tool is active) ------

interface FloorPickerProps {
  cubeSize: number;
  tool: Tool;
  stagedKindId: string | null;
  onPlaceAt: (position: [number, number, number]) => void;
  onClickEmpty: () => void;
}

function FloorPicker({
  cubeSize,
  tool,
  stagedKindId,
  onPlaceAt,
  onClickEmpty,
}: FloorPickerProps) {
  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    // Only respond to LEFT-click. Right-click is owned by the
    // free-fly camera; middle is ignored.
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    const onMove = (m: PointerEvent) => {
      if (
        Math.abs(m.clientX - startX) > 4 ||
        Math.abs(m.clientY - startY) > 4
      ) {
        moved = true;
      }
    };
    const onUp = (u: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (moved || u.button !== 0) return;
      // Tool-specific dispatch:
      //   - add: snap to a voxel cell, ask the parent to place.
      //   - select: empty-click means deselect (parent decides).
      if (tool === 'add' && stagedKindId) {
        const point = e.point;
        const i = Math.round(point.x / cubeSize);
        const j = Math.round(point.z / cubeSize);
        onPlaceAt([i, 0, j]);
      } else if (tool === 'select') {
        onClickEmpty();
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0, 0]}
      onPointerDown={handlePointerDown}
      // Behind the cubes (renderOrder lower) and invisible-but-pickable.
      renderOrder={-2}
    >
      <planeGeometry args={[400, 400]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}
