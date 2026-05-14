import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import {
  CUBE_KINDS,
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
  /** Integer voxel y the Add-tool floor picker sits at. The grid
   * plane at world y=0 is a visual reference; this can be any int
   * (positive or negative) so users can place cubes anywhere along
   * the y axis. */
  buildHeight: number;
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
        position: [0, 8, 14],
        fov: 45,
        near: 0.1,
        far: 500,
      }}
      style={{ width: '100%', height: '100%', display: 'block' }}
      shadows={false}
    >
      <ambientLight intensity={0.6} />
      <directionalLight position={[20, 40, 20]} intensity={1.2} />
      <color attach="background" args={['#0a0a0a']} />
      <EndlessGrid />
      <OrbitCamera compiled={props.compiled} />
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
        buildHeight={props.buildHeight}
        onPlaceAt={props.onPlaceAt}
        onClickEmpty={props.onClickEmpty}
        onHoverFloor={handleHoverChange}
      />
      <GhostLayer ghosts={ghosts} cubeSize={cubeSize} />
      <SelectionOutline
        instances={props.compiled.instances}
        cubeSize={props.compiled.cubeSize}
        selection={props.selection}
      />
    </Canvas>
  );
}

// --- Selection outline (wireframe AABB) -------------------------

interface SelectionOutlineProps {
  instances: ObjectInstance[];
  cubeSize: number;
  selection: ReadonlySet<string>;
}

/**
 * Renders a wireframe box around the AABB of all selected instances
 * (a single command, a group's children, or a multi-select). Replaces
 * the per-instance yellow tint that used to indicate selection — a
 * box around the outer edges is easier to read at a glance,
 * especially for groups.
 *
 * The padding adds a tiny margin so the wireframe sits OUTSIDE the
 * cubes rather than co-planar with them (which would z-fight).
 */
function SelectionOutline({ instances, cubeSize, selection }: SelectionOutlineProps) {
  const bounds = useMemo(() => {
    if (selection.size === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    let any = false;
    for (const inst of instances) {
      if (!selection.has(inst.sourceCommandId)) continue;
      any = true;
      const wx = inst.position[0] * cubeSize;
      const wy = inst.position[1] * cubeSize;
      const wz = inst.position[2] * cubeSize;
      // Each cube occupies a `cubeSize`-wide voxel centered at
      // (wx, wy + cubeSize/2, wz). With a SEAM_OVERLAP of 1.05 the
      // visible extent is slightly wider; round outward.
      const half = (cubeSize * 1.05) / 2;
      if (wx - half < minX) minX = wx - half;
      if (wy < minY) minY = wy;
      if (wz - half < minZ) minZ = wz - half;
      if (wx + half > maxX) maxX = wx + half;
      if (wy + cubeSize > maxY) maxY = wy + cubeSize;
      if (wz + half > maxZ) maxZ = wz + half;
    }
    if (!any) return null;
    const pad = 0.08;
    const sizeX = maxX - minX + pad * 2;
    const sizeY = maxY - minY + pad * 2;
    const sizeZ = maxZ - minZ + pad * 2;
    const center = new THREE.Vector3(
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      (minZ + maxZ) / 2,
    );
    return { center, sizeX, sizeY, sizeZ };
  }, [instances, cubeSize, selection]);

  if (!bounds) return null;
  // `<edgesGeometry>` returns only the 12 cube edges; `<boxGeometry>`
  // + wireframe draws every triangle edge (including the X across
  // each face), which reads as noise on a selection indicator.
  return (
    <lineSegments position={bounds.center} renderOrder={2}>
      <edgesGeometry
        args={[
          new THREE.BoxGeometry(bounds.sizeX, bounds.sizeY, bounds.sizeZ),
        ]}
      />
      <lineBasicMaterial
        color="#fde68a"
        transparent
        opacity={0.95}
        depthTest={false}
      />
    </lineSegments>
  );
}

// --- Orbit camera (canvas-local) --------------------------------

interface OrbitCameraProps {
  /** The compiled room. Used to derive a sensible orbit target —
   * the AABB center of the room's instances. Rooms are bounded
   * spaces; the camera should always be looking AT the room rather
   * than at empty grid. */
  compiled: WorldObjects;
}

/**
 * Orbit camera for the Room editor: right-drag rotates around the
 * room's centroid, scroll dollies in/out, no WASD fly. Mirrors the
 * Character editor's controls — rooms are small bounded spaces, the
 * fly-around UX of the old Scene editor was overkill.
 *
 * Spec: "Room is meant to be a much smaller space and we'd rotate
 * the entire room like we do the character."
 */
function OrbitCamera({ compiled }: OrbitCameraProps) {
  const { camera, gl } = useThree();
  const persp = camera as THREE.PerspectiveCamera;

  // Orbit state. Azimuth/elevation/distance are the canonical spherical
  // coords; the target is the room's center.
  const orbit = useRef({
    azimuth: -0.55,
    elevation: 0.45,
    distance: 16,
  });
  const drag = useRef({ active: false, lastX: 0, lastY: 0 });

  // Recompute the room center from the compiled instances so the camera
  // looks at the room's actual mass, not just the world origin. Empty
  // rooms fall back to origin so the camera looks at where the first
  // cube would land.
  const target = useMemo(() => {
    if (compiled.instances.length === 0) {
      return new THREE.Vector3(0, 1, 0);
    }
    const min = new THREE.Vector3(Infinity, Infinity, Infinity);
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (const inst of compiled.instances) {
      const [x, y, z] = inst.position;
      const wx = x * compiled.cubeSize;
      const wy = y * compiled.cubeSize + compiled.cubeSize / 2;
      const wz = z * compiled.cubeSize;
      if (wx < min.x) min.x = wx;
      if (wy < min.y) min.y = wy;
      if (wz < min.z) min.z = wz;
      if (wx > max.x) max.x = wx;
      if (wy > max.y) max.y = wy;
      if (wz > max.z) max.z = wz;
    }
    return new THREE.Vector3()
      .addVectors(min, max)
      .multiplyScalar(0.5);
  }, [compiled]);

  useEffect(() => {
    const canvas = gl.domElement;

    const onPointerDown = (e: PointerEvent) => {
      // Right-click drag = orbit. Left-click is for tool actions and
      // is handled by R3F's pointer-event system on meshes.
      if (e.button !== 2) return;
      drag.current = { active: true, lastX: e.clientX, lastY: e.clientY };
    };
    const onPointerMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d.active) return;
      const dx = e.clientX - d.lastX;
      const dy = e.clientY - d.lastY;
      d.lastX = e.clientX;
      d.lastY = e.clientY;
      const sens = 0.005;
      orbit.current.azimuth -= dx * sens;
      // Clamp elevation so the camera doesn't flip over the top or
      // duck below the floor.
      orbit.current.elevation = THREE.MathUtils.clamp(
        orbit.current.elevation - dy * sens,
        -0.05,
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
        2,
        80,
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
    const cosE = Math.cos(elevation);
    const sinE = Math.sin(elevation);
    const cosA = Math.cos(azimuth);
    const sinA = Math.sin(azimuth);
    // Spherical → cartesian with target as the origin. azimuth is
    // around +y; elevation 0 is horizon, π/2 is straight overhead.
    persp.position.set(
      target.x + distance * cosE * sinA,
      target.y + distance * sinE,
      target.z + distance * cosE * cosA,
    );
    persp.lookAt(target);
  });

  return null;
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
    const s = new THREE.Vector3(baseScale, baseScale, baseScale);
    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i];
      p.set(
        inst.position[0] * cubeSize,
        inst.position[1] * cubeSize + cubeSize / 2,
        inst.position[2] * cubeSize,
      );
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.count = instances.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    // Per-instance color tinting for selection state was removed in
    // favor of a separate <SelectionOutline> wireframe AABB rendered
    // around all selected instances — see SceneEditorCanvas.tsx.
  }, [instances, cubeSize]);

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
  /** Integer voxel y the picker plane sits at. Q/E shift it in
   * `RoomApp`; the EndlessGrid stays at world y=0 as a visual
   * reference but cube placement is free to happen at any y. */
  buildHeight: number;
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
  buildHeight,
  onPlaceAt,
  onClickEmpty,
  onHoverFloor,
}: FloorPickerProps) {
  // Snap the floor hit at the current build height instead of always
  // y=0. Floor hits give XZ; the build height fills the Y so the
  // picker isn't a hard floor — Q/E in RoomApp let the user place
  // cubes below the grid (y<0) or above it (y>0).
  const snapFloor = (point: { x: number; y: number; z: number }): [number, number, number] => {
    const v = snapToVoxel({ kind: 'floor', point }, cubeSize);
    v[1] = buildHeight;
    return v;
  };

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
        onPlaceAt(snapFloor(point));
      } else if (tool === 'select') {
        onClickEmpty();
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // The hover SnapHit carries the build height directly (rather than
  // letting the upstream snap re-snap to y=0). We forge a
  // FloorHit-like shape but with the picker's world y baked into the
  // point so any subsequent `snapToVoxel` call on this hit produces
  // the right voxel.
  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (tool !== 'add') return;
    // We pass the FloorHit through but force the y to the build
    // height's world equivalent. The parent canvas's `snapToVoxel`
    // computes (round(x/cubeSize), 0, round(z/cubeSize)); we override
    // the y in `snapFloor` above for clicks, and the hover SnapHit
    // is only used to draw the ghost — the ghost layer reads voxel
    // coords post-snap, so we pre-snap here and re-emit.
    const voxel = snapFloor({
      x: e.point.x,
      y: e.point.y,
      z: e.point.z,
    });
    onHoverFloor({
      kind: 'floor',
      point: {
        x: voxel[0] * cubeSize,
        y: voxel[1] * cubeSize,
        z: voxel[2] * cubeSize,
      },
    });
  };

  const handlePointerOut = () => {
    if (tool === 'add') onHoverFloor(null);
  };

  // Picker plane sits at `buildHeight` (in voxel units) + a tiny
  // epsilon above so R3F's raycaster prefers it over the EndlessGrid
  // mesh whenever they overlap (the grid is at world y=0). When
  // buildHeight != 0 the picker is well above/below the grid and
  // there's no overlap; the epsilon only matters at y=0.
  const pickerWorldY = buildHeight * cubeSize + 0.01;
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, pickerWorldY, 0]}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerOut={handlePointerOut}
      renderOrder={-2}
    >
      <planeGeometry args={[400, 400]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}
