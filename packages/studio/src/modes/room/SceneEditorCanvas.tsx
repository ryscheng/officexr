import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { GhostLayer, type GhostSpec } from './GhostLayer.tsx';
import { snapToVoxel, type SnapHit } from './roomSnap.ts';
import {
  extractGeometryFromGltf,
  extractMaterialFromGltf,
} from '@officexr/world/renderer';

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
  // Hover target drives the Add/Tile ghost preview. Updated on
  // pointermove by both the cube layer and the floor picker; cleared
  // when the cursor leaves either.
  const [hover, setHover] = useState<SnapHit | null>(null);
  const handleHoverChange = useCallback(
    (next: SnapHit | null) => setHover(next),
    [],
  );

  const cubeSize = props.compiled.cubeSize;

  // Compute the ghost specs the GhostLayer should render this frame.
  // Today the Add tool emits one solid ghost at the snap target;
  // Tasks 8-9 extend this list with Delete (pulse) + Tile (multiple
  // solids).
  const ghosts = useMemo<GhostSpec[]>(() => {
    if (props.tool !== 'add' || !props.stagedKindId || !hover) return [];
    const voxel = snapToVoxel(hover, cubeSize);
    return [{ mode: 'solid', kindId: props.stagedKindId, voxel }];
  }, [props.tool, props.stagedKindId, hover, cubeSize]);

  // Map an Add-tool click to a placement. Reads from the freshly-
  // computed snap hit rather than the stale `hover` state so a click
  // on a cube face uses the cube's normal, not the last floor hover.
  const handleAddClick = useCallback(
    (hit: SnapHit) => {
      if (props.tool !== 'add' || !props.stagedKindId) return;
      const voxel = snapToVoxel(hit, cubeSize);
      props.onPlaceAt(voxel);
    },
    [props, cubeSize],
  );

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
        onHoverCube={handleHoverChange}
        onAddClick={handleAddClick}
      />
      <FloorPicker
        cubeSize={props.compiled.cubeSize}
        tool={props.tool}
        stagedKindId={props.stagedKindId}
        onPlaceAt={props.onPlaceAt}
        onClickEmpty={props.onClickEmpty}
        onHoverFloor={handleHoverChange}
      />
      <GhostLayer ghosts={ghosts} cubeSize={cubeSize} />
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
  /** Called on pointermove over a cube. Caller uses the SnapHit
   * to drive the Add/Tile ghost preview. `null` clears. */
  onHoverCube: (hit: SnapHit | null) => void;
  /** Add-tool click on a cube face — caller snaps to the adjacent
   * voxel via `snapToVoxel`. */
  onAddClick: (hit: SnapHit) => void;
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
          onHoverCube={props.onHoverCube}
          onAddClick={props.onAddClick}
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
  onHoverCube: (hit: SnapHit | null) => void;
  onAddClick: (hit: SnapHit) => void;
}

function KindGroup({
  kind,
  instances,
  cubeSize,
  selection,
  tool,
  onSelectInstance,
  onHoverCube,
  onAddClick,
}: KindGroupProps) {
  const gltf = useGLTF(kind.gltfPath);
  const geom = useMemo(() => extractGeometryFromGltf(gltf.scene), [gltf.scene]);
  const mat = useMemo(() => {
    const m = (extractMaterialFromGltf(gltf.scene) as THREE.MeshStandardMaterial).clone();
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
    // Only respond to LEFT-click. Right-click is owned by the free-fly
    // camera; middle is ignored.
    if (e.button !== 0) return;
    if (tool !== 'select' && tool !== 'add') return;
    e.stopPropagation();
    const instanceIdx = e.instanceId;
    if (instanceIdx === undefined) return;
    const inst = instances[instanceIdx];
    if (!inst) return;
    // Track drag distance — even with right-click camera, a misfire
    // left-drag shouldn't fire the click action on release.
    const startX = e.clientX;
    const startY = e.clientY;
    const modKey = e.ctrlKey || e.metaKey;
    // Capture the hit info up-front: faceNormal is on the
    // pointer-DOWN event, not pointer-UP.
    const normal = e.face?.normal;
    const cubeHit: SnapHit | null = normal
      ? {
          kind: 'cube',
          cubePosition: inst.position,
          faceNormal: [normal.x, normal.y, normal.z],
        }
      : null;
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
      if (tool === 'select') {
        onSelectInstance(inst.sourceCommandId, modKey);
      } else if (tool === 'add' && cubeHit) {
        onAddClick(cubeHit);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (tool !== 'add') return;
    const instanceIdx = e.instanceId;
    if (instanceIdx === undefined) return;
    const inst = instances[instanceIdx];
    if (!inst) return;
    const n = e.face?.normal;
    if (!n) return;
    // R3F fires pointermove on every raycast intersection front-to-back.
    // Without this stop the floor's handler runs next and overwrites
    // our CubeHit with a y=0 FloorHit, putting the Add ghost on the
    // floor under the cube instead of on its face.
    e.stopPropagation();
    onHoverCube({
      kind: 'cube',
      cubePosition: inst.position,
      faceNormal: [n.x, n.y, n.z],
    });
  };

  return (
    <instancedMesh
      ref={meshRef}
      args={[geom, mat, capacity]}
      castShadow={false}
      receiveShadow={false}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      userData={{ kindId: kind.id, isObjectInstanceMesh: true }}
    />
  );
}

// --- Floor picker (place-on-empty when Add tool is active) ------

interface FloorPickerProps {
  cubeSize: number;
  tool: Tool;
  stagedKindId: string | null;
  onPlaceAt: (position: [number, number, number]) => void;
  onClickEmpty: () => void;
  /** Called on pointermove over the floor with a SnapHit so the
   * parent can drive the Add/Tile ghost preview. */
  onHoverFloor: (hit: SnapHit | null) => void;
}

function FloorPicker({
  cubeSize,
  tool,
  stagedKindId,
  onPlaceAt,
  onClickEmpty,
  onHoverFloor,
}: FloorPickerProps) {
  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const point = { x: e.point.x, y: e.point.y, z: e.point.z };
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
      if (tool === 'add' && stagedKindId) {
        const voxel = snapToVoxel(
          { kind: 'floor', point },
          cubeSize,
        );
        onPlaceAt(voxel);
      } else if (tool === 'select') {
        onClickEmpty();
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (tool !== 'add') return;
    onHoverFloor({
      kind: 'floor',
      point: { x: e.point.x, y: e.point.y, z: e.point.z },
    });
  };

  const handlePointerOut = () => {
    if (tool === 'add') onHoverFloor(null);
  };

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0, 0]}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerOut={handlePointerOut}
      // Behind the cubes (renderOrder lower) and invisible-but-pickable.
      renderOrder={-2}
    >
      <planeGeometry args={[400, 400]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}
