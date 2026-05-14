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

type Vec3 = [number, number, number];

/**
 * Tile tool state machine. Spec from the PRD:
 *
 *   - idle:        before click 1 — show 1 solid ghost under cursor.
 *   - placed:      click 1 placed origin; hovering shows ghosts
 *                  along ±x from origin sized by mouse delta.
 *   - x-extruded:  click 2 committed the X row + grouped them;
 *                  hovering shows the X row replicated along ±z.
 *   - z-extruded:  click 3 committed the X*Z slab + grew the group;
 *                  hovering shows the slab replicated along ±y.
 *
 * Click 4 commits the Y stack and returns to Select. Esc commits
 * whatever's-real-so-far (nothing extra — every click already
 * committed something) and returns to Select.
 *
 * `groupId` is null until click 2 (no point grouping a singleton);
 * after that it accumulates every subsequent click's commands.
 */
type TileState =
  | { stage: 'idle' }
  | {
      stage: 'placed';
      origin: Vec3;
      kindId: string;
      originCommandId: string;
    }
  | {
      stage: 'x-extruded';
      origin: Vec3;
      kindId: string;
      groupId: string;
      xRow: readonly Vec3[];
    }
  | {
      stage: 'z-extruded';
      origin: Vec3;
      kindId: string;
      groupId: string;
      xzGrid: readonly Vec3[];
    };

/** Generate the X-row preview voxels for the placed stage. Excludes
 * the origin (which is already a real cube). */
function tileXRow(origin: Vec3, hover: SnapHit | null, cubeSize: number): Vec3[] {
  if (!hover) return [];
  const v = snapToVoxel(hover, cubeSize);
  const dx = v[0] - origin[0];
  if (dx === 0) return [];
  const sign = Math.sign(dx);
  const count = Math.abs(dx);
  const out: Vec3[] = [];
  for (let i = 1; i <= count; i++) {
    out.push([origin[0] + sign * i, origin[1], origin[2]]);
  }
  return out;
}

/** Replicate the X row along ±z for the x-extruded stage's preview. */
function tileZReplicas(
  origin: Vec3,
  xRow: readonly Vec3[],
  hover: SnapHit | null,
  cubeSize: number,
): Vec3[] {
  if (!hover) return [];
  const v = snapToVoxel(hover, cubeSize);
  const dz = v[2] - origin[2];
  if (dz === 0) return [];
  const sign = Math.sign(dz);
  const count = Math.abs(dz);
  // Replicate origin + xRow, since the entire X row including origin
  // is what shifts in z.
  const fullRow: Vec3[] = [origin, ...xRow];
  const out: Vec3[] = [];
  for (let i = 1; i <= count; i++) {
    for (const p of fullRow) {
      out.push([p[0], p[1], p[2] + sign * i]);
    }
  }
  return out;
}

/** Replicate the XZ slab along ±y for the z-extruded stage's preview.
 * Y direction is derived from the cursor's vertical movement off the
 * origin's screen position — see `yVoxelDelta`. */
function tileYReplicas(
  xzGrid: readonly Vec3[],
  yDelta: number,
): Vec3[] {
  if (yDelta === 0) return [];
  const sign = Math.sign(yDelta);
  const count = Math.abs(yDelta);
  const out: Vec3[] = [];
  for (let i = 1; i <= count; i++) {
    for (const p of xzGrid) {
      out.push([p[0], p[1] + sign * i, p[2]]);
    }
  }
  return out;
}
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
  /** Lookup tables for selection / delete cascade — maps each
   * commandId to its group (if any) so the Delete tool's pulse
   * ghosts cover every group member. */
  commandToGroup: ReadonlyMap<string, string>;
  groupMembers: ReadonlyMap<string, readonly string[]>;
  /** Click on an empty cell (no cube hit) with the Add tool active —
   * places a cube of the staged kind at the picked floor position.
   * Coords are integer voxels. */
  onPlaceAt: (position: [number, number, number]) => void;
  /** Click on an existing cube with the Select tool active. `modKey`
   * is true when Ctrl or Cmd was held — caller maps that to toggle
   * vs. replace semantics. */
  onSelectInstance: (commandId: string, modKey: boolean) => void;
  /** Click on an existing cube with the Delete tool active. Deletes
   * the command (cascading through the group if any). */
  onDeleteCommand: (commandId: string) => void;
  /** Tile-tool placement: batch-create N cubes at the given voxel
   * positions, optionally adding them all to the same group. Returns
   * the new commandIds. */
  onPlaceMany: (
    kindId: string,
    positions: ReadonlyArray<[number, number, number]>,
    groupId?: string | null,
  ) => string[];
  /** Tile-tool group creation. Called after click 2 once we have ≥2
   * cubes to bundle. Returns the new groupId. */
  onCreateGroup: (commandIds: Iterable<string>) => string | null;
  /** Click on EMPTY floor with the Select tool — deselects. The
   * canvas only knows that the click missed every cube; the parent
   * decides whether that means "deselect" or some other action. */
  onClickEmpty: () => void;
  /** Tool-state external setter. Tile tool returns to Select on
   * click 4 / Esc; the canvas owns the tile state machine but the
   * `tool` lives in the parent. */
  onSetTool: (tool: Tool) => void;
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
  // Add/Tile snap target — populated by pointermove on floor or cube.
  const [hover, setHover] = useState<SnapHit | null>(null);
  // Delete hover — populated by pointermove on a cube when the
  // Delete tool is active. Carries the sourceCommandId so we can
  // emit pulse ghosts for every instance the command (or its group)
  // produced.
  const [hoverCommandId, setHoverCommandId] = useState<string | null>(null);

  // Tile-tool state machine. Discriminated union over the four
  // stages — see the comment at TileState's definition for the spec.
  const [tileState, setTileState] = useState<TileState>({ stage: 'idle' });

  // Reset the tile state whenever the tool changes away from Tile so
  // a half-completed gesture doesn't leak across tool switches.
  useEffect(() => {
    if (props.tool !== 'tile') setTileState({ stage: 'idle' });
  }, [props.tool]);

  // Screen-Y anchor for the Tile tool's stage-4 (z-extruded) y-delta
  // picker. After click 3 we capture the current cursor screen Y;
  // each ~28 pixels of vertical movement above/below it counts as 1
  // voxel up/down. Tracked in a ref + state pair so the ghosts
  // re-render but the listener doesn't re-bind every frame.
  const yAnchorRef = useRef<number | null>(null);
  const [yDelta, setYDelta] = useState<number>(0);
  useEffect(() => {
    if (tileState.stage !== 'z-extruded') {
      yAnchorRef.current = null;
      setYDelta(0);
      return;
    }
    const PIXELS_PER_VOXEL = 28;
    const onMove = (e: MouseEvent) => {
      if (yAnchorRef.current === null) yAnchorRef.current = e.clientY;
      const dy = yAnchorRef.current - e.clientY; // up on screen → +y voxels
      setYDelta(Math.round(dy / PIXELS_PER_VOXEL));
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [tileState.stage]);

  // Esc commits-real-and-exits at any stage. Listening at window level
  // here keeps the tile state in the canvas's hands — RoomApp's Esc
  // handler only resets the active tool + selection, and the effect
  // above clears tile state when the tool flips away.
  useEffect(() => {
    if (props.tool !== 'tile') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      setTileState({ stage: 'idle' });
      props.onSetTool('select');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);

  const handleHoverChange = useCallback(
    (next: SnapHit | null) => setHover(next),
    [],
  );
  const handleHoverCommand = useCallback(
    (commandId: string | null) => setHoverCommandId(commandId),
    [],
  );

  const cubeSize = props.compiled.cubeSize;

  // Compute the ghost specs the GhostLayer should render this frame.
  //   Add tool: one SOLID ghost at the snap target (pre-placement).
  //   Delete tool: one PULSE ghost per cube in the hovered command's
  //   group (or just the hovered command if it's not in a group).
  //   Tile tool: depends on the active stage (idle/placed/x-extruded/
  //   z-extruded). See the TileState comment for the spec.
  const ghosts = useMemo<GhostSpec[]>(() => {
    if (props.tool === 'add' && props.stagedKindId && hover) {
      const voxel = snapToVoxel(hover, cubeSize);
      return [{ mode: 'solid', kindId: props.stagedKindId, voxel }];
    }
    if (props.tool === 'delete' && hoverCommandId) {
      const groupId = props.commandToGroup.get(hoverCommandId);
      const targetCommandIds = groupId
        ? props.groupMembers.get(groupId) ?? [hoverCommandId]
        : [hoverCommandId];
      const targets = new Set(targetCommandIds);
      const out: GhostSpec[] = [];
      for (const inst of props.compiled.instances) {
        if (!targets.has(inst.sourceCommandId)) continue;
        out.push({
          mode: 'pulse',
          kindId: inst.kindId,
          voxel: [inst.position[0], inst.position[1], inst.position[2]],
        });
      }
      return out;
    }
    if (props.tool === 'tile') {
      const out: GhostSpec[] = [];
      if (tileState.stage === 'idle' && props.stagedKindId && hover) {
        const voxel = snapToVoxel(hover, cubeSize);
        out.push({ mode: 'solid', kindId: props.stagedKindId, voxel });
      } else if (tileState.stage === 'placed') {
        for (const v of tileXRow(tileState.origin, hover, cubeSize)) {
          out.push({ mode: 'solid', kindId: tileState.kindId, voxel: v });
        }
      } else if (tileState.stage === 'x-extruded') {
        for (const v of tileZReplicas(
          tileState.origin,
          tileState.xRow,
          hover,
          cubeSize,
        )) {
          out.push({ mode: 'solid', kindId: tileState.kindId, voxel: v });
        }
      } else if (tileState.stage === 'z-extruded') {
        for (const v of tileYReplicas(tileState.xzGrid, yDelta)) {
          out.push({ mode: 'solid', kindId: tileState.kindId, voxel: v });
        }
      }
      return out;
    }
    return [];
  }, [
    props.tool,
    props.stagedKindId,
    hover,
    hoverCommandId,
    cubeSize,
    props.commandToGroup,
    props.groupMembers,
    props.compiled.instances,
    tileState,
    yDelta,
  ]);

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

  // Delete-tool click on a cube routes to the parent's delete (which
  // cascades through groups via useRoomDocument.deleteCommand).
  const handleDeleteClick = useCallback(
    (commandId: string) => {
      if (props.tool !== 'delete') return;
      props.onDeleteCommand(commandId);
      setHoverCommandId(null);
    },
    [props],
  );

  // Tile-tool click dispatcher. Drives the 4-stage state machine
  // forward. Every click commits the cubes that were being previewed
  // as ghosts, then advances to the next stage. Click 4 commits the
  // Y stack and returns to Select.
  const handleTileClick = useCallback(
    (hit: SnapHit) => {
      if (props.tool !== 'tile' || !props.stagedKindId) return;
      const stagedKindId = props.stagedKindId;
      if (tileState.stage === 'idle') {
        // Click 1: place the origin cube.
        const voxel = snapToVoxel(hit, cubeSize);
        const ids = props.onPlaceMany(stagedKindId, [voxel]);
        if (ids.length === 0) return;
        setTileState({
          stage: 'placed',
          origin: voxel,
          kindId: stagedKindId,
          originCommandId: ids[0],
        });
        return;
      }
      if (tileState.stage === 'placed') {
        // Click 2: commit the X row (if any) + create the group.
        const xRow = tileXRow(tileState.origin, hit, cubeSize);
        if (xRow.length > 0) {
          const newIds = props.onPlaceMany(stagedKindId, xRow);
          const groupId = props.onCreateGroup([
            tileState.originCommandId,
            ...newIds,
          ]);
          if (groupId) {
            setTileState({
              stage: 'x-extruded',
              origin: tileState.origin,
              kindId: tileState.kindId,
              groupId,
              xRow,
            });
            return;
          }
        }
        // Empty X row → stay in `placed` (the user can move and click
        // again, or Esc out with just the origin placed).
        return;
      }
      if (tileState.stage === 'x-extruded') {
        // Click 3: commit Z replicas, extending the group.
        const zReplicas = tileZReplicas(
          tileState.origin,
          tileState.xRow,
          hit,
          cubeSize,
        );
        if (zReplicas.length > 0) {
          props.onPlaceMany(stagedKindId, zReplicas, tileState.groupId);
          // The slab is now origin + xRow + zReplicas.
          const xzGrid = [tileState.origin, ...tileState.xRow, ...zReplicas];
          setTileState({
            stage: 'z-extruded',
            origin: tileState.origin,
            kindId: tileState.kindId,
            groupId: tileState.groupId,
            xzGrid,
          });
        }
        return;
      }
      if (tileState.stage === 'z-extruded') {
        // Click 4: commit Y replicas, extending the group, then exit.
        const yReplicas = tileYReplicas(tileState.xzGrid, yDelta);
        if (yReplicas.length > 0) {
          props.onPlaceMany(stagedKindId, yReplicas, tileState.groupId);
        }
        setTileState({ stage: 'idle' });
        props.onSetTool('select');
        return;
      }
    },
    [props, tileState, cubeSize, yDelta],
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
        onHoverCommand={handleHoverCommand}
        onAddClick={handleAddClick}
        onDeleteClick={handleDeleteClick}
        onTileClick={handleTileClick}
      />
      <FloorPicker
        cubeSize={props.compiled.cubeSize}
        tool={props.tool}
        stagedKindId={props.stagedKindId}
        buildHeight={props.buildHeight}
        onPlaceAt={props.onPlaceAt}
        onClickEmpty={props.onClickEmpty}
        onHoverFloor={handleHoverChange}
        onTileClick={handleTileClick}
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
  /** Called on pointermove over a cube. Caller uses the SnapHit to
   * drive the Add/Tile ghost preview (snap target = cube face's
   * adjacent voxel). `null` clears. */
  onHoverCube: (hit: SnapHit | null) => void;
  /** Called on pointermove over a cube with the cube's sourceCommandId
   * so the Delete tool can expand to the whole group and emit pulse
   * ghosts. `null` clears. */
  onHoverCommand: (commandId: string | null) => void;
  /** Add-tool click on a cube face — caller snaps to the adjacent
   * voxel via `snapToVoxel`. */
  onAddClick: (hit: SnapHit) => void;
  /** Delete-tool click — caller deletes the command (cascading
   * through groups). */
  onDeleteClick: (commandId: string) => void;
  /** Tile-tool click — caller advances the tile state machine. */
  onTileClick: (hit: SnapHit) => void;
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
          onHoverCommand={props.onHoverCommand}
          onAddClick={props.onAddClick}
          onDeleteClick={props.onDeleteClick}
          onTileClick={props.onTileClick}
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
  onHoverCommand: (commandId: string | null) => void;
  onAddClick: (hit: SnapHit) => void;
  onDeleteClick: (commandId: string) => void;
  onTileClick: (hit: SnapHit) => void;
}

function KindGroup({
  kind,
  instances,
  cubeSize,
  selection,
  tool,
  onSelectInstance,
  onHoverCube,
  onHoverCommand,
  onAddClick,
  onDeleteClick,
  onTileClick,
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
    // Only respond to LEFT-click. Right-click is owned by the camera.
    if (e.button !== 0) return;
    if (
      tool !== 'select' &&
      tool !== 'add' &&
      tool !== 'delete' &&
      tool !== 'tile'
    )
      return;
    e.stopPropagation();
    const instanceIdx = e.instanceId;
    if (instanceIdx === undefined) return;
    const inst = instances[instanceIdx];
    if (!inst) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const modKey = e.ctrlKey || e.metaKey;
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
      } else if (tool === 'delete') {
        onDeleteClick(inst.sourceCommandId);
      } else if (tool === 'tile' && cubeHit) {
        onTileClick(cubeHit);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (tool !== 'add' && tool !== 'delete' && tool !== 'tile') return;
    const instanceIdx = e.instanceId;
    if (instanceIdx === undefined) return;
    const inst = instances[instanceIdx];
    if (!inst) return;
    // R3F fires pointermove on every raycast intersection front-to-back.
    // Stop here so the floor's handler doesn't overwrite our cube state.
    e.stopPropagation();
    if (tool === 'add' || tool === 'tile') {
      const n = e.face?.normal;
      if (!n) return;
      onHoverCube({
        kind: 'cube',
        cubePosition: inst.position,
        faceNormal: [n.x, n.y, n.z],
      });
    } else {
      onHoverCommand(inst.sourceCommandId);
    }
  };

  const handlePointerOut = () => {
    if (tool === 'delete') onHoverCommand(null);
  };

  return (
    <instancedMesh
      ref={meshRef}
      args={[geom, mat, capacity]}
      castShadow={false}
      receiveShadow={false}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerOut={handlePointerOut}
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
  /** Tile-tool click on empty floor — caller advances the tile
   * state machine. */
  onTileClick: (hit: SnapHit) => void;
}

function FloorPicker({
  cubeSize,
  tool,
  stagedKindId,
  buildHeight,
  onPlaceAt,
  onClickEmpty,
  onHoverFloor,
  onTileClick,
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
      } else if (tool === 'tile' && stagedKindId) {
        // Build a synthetic FloorHit with the build-height baked into
        // the point's y so downstream `snapToVoxel` picks the right
        // voxel; the tile state machine then uses `snapToVoxel` on
        // this hit.
        const voxel = snapFloor(point);
        onTileClick({
          kind: 'floor',
          point: {
            x: voxel[0] * cubeSize,
            y: voxel[1] * cubeSize,
            z: voxel[2] * cubeSize,
          },
        });
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
    if (tool !== 'add' && tool !== 'tile') return;
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
    if (tool === 'add' || tool === 'tile') onHoverFloor(null);
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
