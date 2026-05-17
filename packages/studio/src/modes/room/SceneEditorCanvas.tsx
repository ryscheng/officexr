import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import {
  DEFAULT_EDITOR_LIGHTING,
  EndlessGrid,
  LightingRig,
  ObjectInstances,
} from '@officexr/world/renderer';

const ROOM_EDITOR_LIGHTING = {
  ...DEFAULT_EDITOR_LIGHTING,
  sunPosition: [20, 40, 20] as [number, number, number],
  sunIntensity: 1.2,
  ambientFillIntensity: 0.6,
};
import type { ObjectInstance, WorldObjects } from '@officexr/sdk';
import { getKind } from '@officexr/world/scenes';
import type { RoomDocument } from '@officexr/world/scenes';
import type { Tool } from './tools.ts';
import { GhostLayer, type GhostSpec } from './GhostLayer.tsx';
import {
  snapToNearestTileableFace,
  snapToVoxel,
  type SnapHit,
  type TileableObjectInfo,
} from './roomSnap.ts';
import { outlineEdgePositions, type Vec3 as VoxelVec3 } from './selectionOutline.ts';
import { computeMovedPositions } from './moveDelta.ts';
import { checkMoveOccupancy } from './moveOccupancy.ts';

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

/**
 * Move tool drag state. Discriminated union over two stages:
 *   - idle:     no drag in progress.
 *   - dragging: user is dragging selected objects. Records the voxel
 *               the pointer was over when the drag started, whether
 *               Shift is held (Y-axis-only drag), and the original
 *               positions of all selected objects.
 */
type MoveState =
  | { stage: 'idle' }
  | {
      stage: 'dragging';
      startVoxel: Vec3;         // voxel at pointer-down
      isYAxis: boolean;         // Shift held at drag start
      originalPositions: ReadonlyMap<string, Vec3>;
      proposedPositions: ReadonlyMap<string, Vec3>;
      occupancyResult: 'ok' | 'blocked';
    };

/** Generate the X-row preview voxels for the placed stage. Excludes
 * the origin (which is already a real cube).
 * @param step - Optional tile step in the X direction (default 1). When > 1,
 *   the row steps in multiples of `step` rather than individual voxels. */
function tileXRow(
  origin: Vec3,
  hover: SnapHit | null,
  voxelSize: number,
  step: number = 1,
): Vec3[] {
  if (!hover) return [];
  const v = snapToVoxel(hover, voxelSize, { x: step, y: 1, z: 1 });
  const dx = v[0] - origin[0];
  if (dx === 0) return [];
  const sign = Math.sign(dx);
  // Round the delta to the nearest whole-step count
  const steps = Math.round(Math.abs(dx) / step);
  const out: Vec3[] = [];
  for (let i = 1; i <= steps; i++) {
    out.push([origin[0] + sign * i * step, origin[1], origin[2]]);
  }
  return out;
}

/** Replicate the X row along ±z for the x-extruded stage's preview.
 * @param step - Optional tile step in the Z direction (default 1). */
function tileZReplicas(
  origin: Vec3,
  xRow: readonly Vec3[],
  hover: SnapHit | null,
  voxelSize: number,
  step: number = 1,
): Vec3[] {
  if (!hover) return [];
  const v = snapToVoxel(hover, voxelSize, { x: 1, y: 1, z: step });
  const dz = v[2] - origin[2];
  if (dz === 0) return [];
  const sign = Math.sign(dz);
  // Round the delta to the nearest whole-step count
  const steps = Math.round(Math.abs(dz) / step);
  // Replicate origin + xRow, since the entire X row including origin
  // is what shifts in z.
  const fullRow: Vec3[] = [origin, ...xRow];
  const out: Vec3[] = [];
  for (let i = 1; i <= steps; i++) {
    for (const p of fullRow) {
      out.push([p[0], p[1], p[2] + sign * i * step]);
    }
  }
  return out;
}

/** Replicate the XZ slab along ±y for the z-extruded stage's preview.
 * Y direction is derived from the cursor's vertical movement off the
 * origin's screen position — see `yVoxelDelta`.
 * @param step - Optional tile step in the Y direction (default 1). */
function tileYReplicas(
  xzGrid: readonly Vec3[],
  yDelta: number,
  step: number = 1,
): Vec3[] {
  if (yDelta === 0) return [];
  const sign = Math.sign(yDelta);
  const steps = Math.round(Math.abs(yDelta) / step);
  if (steps === 0) return [];
  const out: Vec3[] = [];
  for (let i = 1; i <= steps; i++) {
    for (const p of xzGrid) {
      out.push([p[0], p[1] + sign * i * step, p[2]]);
    }
  }
  return out;
}

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
  /** Right-click without drag — opens the context menu. The canvas
   * supplies the cube's sourceCommandId if a cube was hit, else null.
   * The parent decides menu visibility + items based on selection
   * state. */
  onContextMenuRequest: (
    commandId: string | null,
    screenX: number,
    screenY: number,
  ) => void;
  /** Raw room document — needed by the move tool for occupancy checks
   * and delta translation. Must stay in sync with `compiled`. */
  doc: RoomDocument;
  /** Move-tool batched position update. Called on successful drag-
   * release. One history action per drag (once Task 03 lands). */
  onMoveSelection: (
    moves: Array<{ commandId: string; position: [number, number, number] }>,
  ) => void;
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

  // Move-tool state machine. Idle until a pointer-down on a selected
  // cube starts a drag; dragging tracks delta + occupancy until release.
  const [moveState, setMoveState] = useState<MoveState>({ stage: 'idle' });
  // Ghost specs for the move tool (separate from tile/add/delete ghosts
  // so they can be merged at the GhostLayer call site).
  const [moveGhosts, setMoveGhosts] = useState<GhostSpec[]>([]);

  // Reset move state when switching away from the move tool.
  useEffect(() => {
    if (props.tool !== 'move') {
      setMoveState({ stage: 'idle' });
      setMoveGhosts([]);
    }
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

  // Esc while mid-drag cancels the move without committing.
  useEffect(() => {
    if (props.tool !== 'move') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      setMoveState({ stage: 'idle' });
      setMoveGhosts([]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.tool]);

  const handleHoverChange = useCallback(
    (next: SnapHit | null) => setHover(next),
    [],
  );
  const handleHoverCommand = useCallback(
    (commandId: string | null) => setHoverCommandId(commandId),
    [],
  );

  // Read the voxel size from the SDK WorldObjects shape (field is named
  // cubeSize there for SDK back-compat; we alias it locally).
  const voxelSize = props.compiled.cubeSize;

  // Cache the list of tileable placed objects for snap-to-face.
  // Recomputed only when compiled.instances changes.
  // ISP note: We use a fixed 1-voxel (voxelSize) dims default because
  // getKindBoundingDimensions requires a GLTF scene object from the drei
  // cache, which is not available in this non-R3F hook scope. The pure
  // snapToNearestTileableFace function is correct; the dims approximation
  // is a wiring simplification — future work can pass real dims once GLTF
  // caching is plumbed through to this level.
  const tileableObjects = useMemo<TileableObjectInfo[]>(() => {
    const defaultDims = { width: voxelSize, height: voxelSize, depth: voxelSize };
    return props.compiled.instances
      .filter((inst) => {
        const kind = getKind(inst.kindId);
        if (!kind) return false;
        return kind.tilingAxes.x || kind.tilingAxes.y || kind.tilingAxes.z;
      })
      .map((inst) => ({
        position: inst.position,
        dims: defaultDims,
      }));
  }, [props.compiled.instances, voxelSize]);

  // Snap a world-space hit to a voxel, routing to snapToNearestTileableFace
  // when the staged kind is non-tileable (all tilingAxes false).
  const snapForAdd = useCallback(
    (hit: SnapHit): [number, number, number] => {
      if (!props.stagedKindId) return snapToVoxel(hit, voxelSize);
      const kind = getKind(props.stagedKindId);
      if (kind && !kind.tilingAxes.x && !kind.tilingAxes.y && !kind.tilingAxes.z) {
        // Non-tileable kind: snap to nearest tileable face
        const hitPoint = hit.kind === 'floor'
          ? { x: hit.point.x, y: hit.point.y, z: hit.point.z }
          : {
              // Use the face center as the hit point for cube hits
              x: hit.cubePosition[0] * voxelSize,
              y: hit.cubePosition[1] * voxelSize,
              z: hit.cubePosition[2] * voxelSize,
            };
        const dims = { width: voxelSize, height: voxelSize, depth: voxelSize };
        return snapToNearestTileableFace(hitPoint, dims, tileableObjects, voxelSize);
      }
      return snapToVoxel(hit, voxelSize);
    },
    [props.stagedKindId, voxelSize, tileableObjects],
  );

  // Compute the ghost specs the GhostLayer should render this frame.
  // Selection no longer emits a ghost overlay — the per-cluster
  // wireframe in <SelectionOutline> is the sole selection indicator.
  // Tool-specific previews:
  //   Add: one SOLID ghost at the snap target.
  //   Delete: one PULSE ghost per cube in the hovered command's group.
  //   Tile: ghosts depending on stage (idle/placed/x-extruded/z-extruded).
  const ghosts = useMemo<GhostSpec[]>(() => {
    const out: GhostSpec[] = [];
    if (props.tool === 'add' && props.stagedKindId && hover) {
      const voxel = snapForAdd(hover);
      out.push({ mode: 'solid', kindId: props.stagedKindId, voxel });
    }
    if (props.tool === 'delete' && hoverCommandId) {
      const groupId = props.commandToGroup.get(hoverCommandId);
      const targetCommandIds = groupId
        ? props.groupMembers.get(groupId) ?? [hoverCommandId]
        : [hoverCommandId];
      const targets = new Set(targetCommandIds);
      for (const inst of props.compiled.instances) {
        if (!targets.has(inst.sourceCommandId)) continue;
        out.push({
          mode: 'pulse',
          kindId: inst.kindId,
          voxel: [inst.position[0], inst.position[1], inst.position[2]],
        });
      }
    }
    if (props.tool === 'tile') {
      if (tileState.stage === 'idle' && props.stagedKindId && hover) {
        const voxel = snapToVoxel(hover, voxelSize);
        out.push({ mode: 'solid', kindId: props.stagedKindId, voxel });
      } else if (tileState.stage === 'placed') {
        for (const v of tileXRow(tileState.origin, hover, voxelSize)) {
          out.push({ mode: 'solid', kindId: tileState.kindId, voxel: v });
        }
      } else if (tileState.stage === 'x-extruded') {
        for (const v of tileZReplicas(
          tileState.origin,
          tileState.xRow,
          hover,
          voxelSize,
        )) {
          out.push({ mode: 'solid', kindId: tileState.kindId, voxel: v });
        }
      } else if (tileState.stage === 'z-extruded') {
        for (const v of tileYReplicas(tileState.xzGrid, yDelta)) {
          out.push({ mode: 'solid', kindId: tileState.kindId, voxel: v });
        }
      }
    }
    // Move-tool ghosts are computed by the MoveController and stored
    // separately so the XZ-plane raycasting (which needs camera + gl
    // refs) can live in a Canvas-side component.
    for (const g of moveGhosts) {
      out.push(g);
    }
    return out;
  }, [
    props.tool,
    props.stagedKindId,
    hover,
    hoverCommandId,
    voxelSize,
    props.commandToGroup,
    props.groupMembers,
    props.compiled.instances,
    tileState,
    yDelta,
    moveGhosts,
    snapForAdd,
  ]);

  // Map an Add-tool click to a placement. Reads from the freshly-
  // computed snap hit rather than the stale `hover` state so a click
  // on a cube face uses the cube's normal, not the last floor hover.
  const handleAddClick = useCallback(
    (hit: SnapHit) => {
      if (props.tool !== 'add' || !props.stagedKindId) return;
      const voxel = snapForAdd(hit);
      props.onPlaceAt(voxel);
    },
    [props, snapForAdd],
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
        const voxel = snapToVoxel(hit, voxelSize);
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
        const xRow = tileXRow(tileState.origin, hit, voxelSize);
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
          voxelSize,
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
    [props, tileState, voxelSize, yDelta],
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
      <LightingRig lighting={ROOM_EDITOR_LIGHTING} />
      <color attach="background" args={['#0a0a0a']} />
      <EndlessGrid />
      <OrbitCamera compiled={props.compiled} />
      <MoveController
        tool={props.tool}
        doc={props.doc}
        compiled={props.compiled}
        selection={props.selection}
        moveState={moveState}
        setMoveState={setMoveState}
        setMoveGhosts={setMoveGhosts}
        onMoveSelection={props.onMoveSelection}
        onSelectInstance={props.onSelectInstance}
      />
      <CubesLayer
        instances={props.compiled.instances}
        voxelSize={props.compiled.cubeSize}
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
        voxelSize={props.compiled.cubeSize}
        tool={props.tool}
        stagedKindId={props.stagedKindId}
        buildHeight={props.buildHeight}
        onPlaceAt={props.onPlaceAt}
        onClickEmpty={props.onClickEmpty}
        onHoverFloor={handleHoverChange}
        onTileClick={handleTileClick}
      />
      <GhostLayer ghosts={ghosts} voxelSize={voxelSize} />
      <SelectionOutline
        instances={props.compiled.instances}
        voxelSize={props.compiled.cubeSize}
        selection={props.selection}
      />
      <BuildHeightPlane
        buildHeight={props.buildHeight}
        voxelSize={props.compiled.cubeSize}
        visible={props.tool === 'add' || props.tool === 'tile'}
      />
      <ContextMenuListener
        instances={props.compiled.instances}
        voxelSize={props.compiled.cubeSize}
        onRequest={props.onContextMenuRequest}
      />
    </Canvas>
  );
}

// --- Right-click context menu listener -------------------------

interface ContextMenuListenerProps {
  instances: ObjectInstance[];
  voxelSize: number;
  onRequest: (
    commandId: string | null,
    screenX: number,
    screenY: number,
  ) => void;
}

/**
 * Captures right-click events on the canvas and translates them into
 * context-menu requests. Distinguishes a bare right-click (open
 * menu) from a right-click-drag (orbit camera) by tracking the
 * pointer movement between pointerdown and pointerup; >4px ⇒ drag.
 *
 * Hit-tests via the active R3F raycaster + camera against a synthetic
 * BoxGeometry mesh per instance. We don't have direct access to the
 * InstancedMesh refs from this scope, so we approximate by
 * intersecting voxel AABBs analytically — exact enough for picking
 * 1×1×1 cubes on a grid.
 */
function ContextMenuListener({
  instances,
  voxelSize,
  onRequest,
}: ContextMenuListenerProps) {
  const { gl, camera, raycaster, pointer } = useThree();

  useEffect(() => {
    const canvas = gl.domElement;
    let downX = 0;
    let downY = 0;
    let dragged = false;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 2) return;
      downX = e.clientX;
      downY = e.clientY;
      dragged = false;
    };
    const onMove = (e: PointerEvent) => {
      if (!(e.buttons & 2)) return;
      if (
        Math.abs(e.clientX - downX) > 4 ||
        Math.abs(e.clientY - downY) > 4
      ) {
        dragged = true;
      }
    };
    const onUp = (e: PointerEvent) => {
      if (e.button !== 2) return;
      if (dragged) return;
      // No drag → context-menu intent. Translate the click to NDC and
      // raycast against an analytic voxel AABB per instance to find
      // the cube under the cursor (if any).
      const rect = canvas.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      // Re-use R3F's raycaster + camera with the synthetic pointer.
      const savedX = pointer.x;
      const savedY = pointer.y;
      pointer.x = nx;
      pointer.y = ny;
      raycaster.setFromCamera(pointer, camera);
      // Restore the pointer so R3F's normal event loop isn't confused.
      pointer.x = savedX;
      pointer.y = savedY;

      let bestT = Infinity;
      let bestId: string | null = null;
      const half = voxelSize / 2;
      for (const inst of instances) {
        const cx = inst.position[0] * voxelSize;
        const cy = inst.position[1] * voxelSize + voxelSize / 2;
        const cz = inst.position[2] * voxelSize;
        const t = rayHitAabb(
          raycaster.ray.origin,
          raycaster.ray.direction,
          [cx - half, cy - half, cz - half],
          [cx + half, cy + half, cz + half],
        );
        if (t !== null && t < bestT) {
          bestT = t;
          bestId = inst.sourceCommandId;
        }
      }

      onRequest(bestId, e.clientX, e.clientY);
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
    };
  }, [gl, camera, raycaster, pointer, instances, voxelSize, onRequest]);

  return null;
}

/** Ray vs axis-aligned bounding box. Returns the smaller positive t
 * at which the ray enters the box, or null if it misses or hits only
 * behind the ray origin. Slab method — fast and dependency-free. */
function rayHitAabb(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  min: [number, number, number],
  max: [number, number, number],
): number | null {
  let tMin = -Infinity;
  let tMax = Infinity;
  const o = [origin.x, origin.y, origin.z];
  const d = [dir.x, dir.y, dir.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < min[i] || o[i] > max[i]) return null;
      continue;
    }
    const invD = 1 / d[i];
    let t1 = (min[i] - o[i]) * invD;
    let t2 = (max[i] - o[i]) * invD;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return null;
  }
  if (tMax < 0) return null;
  return tMin > 0 ? tMin : tMax;
}

// --- Selection outline (wireframe AABB) -------------------------

interface SelectionOutlineProps {
  instances: ObjectInstance[];
  voxelSize: number;
  selection: ReadonlySet<string>;
}

/**
 * Renders a wireframe that traces the actual silhouette of the
 * selection — exterior-face edges of every selected voxel, deduped
 * where two cubes share a face's perimeter. An L-shape selection
 * outlines an L (with the inner corner visible) rather than a
 * rectangle that includes empty space. Disjoint cubes naturally
 * produce disjoint outlines because they share no faces.
 *
 * Edges sit on exact voxel boundaries so dedup is precise; the
 * material uses `depthTest: false` so the wireframe stays visible
 * even when coplanar with the cube surface.
 */
function SelectionOutline({ instances, voxelSize, selection }: SelectionOutlineProps) {
  const geometry = useMemo(() => {
    if (selection.size === 0) return null;
    const voxels: VoxelVec3[] = [];
    for (const inst of instances) {
      if (!selection.has(inst.sourceCommandId)) continue;
      voxels.push([inst.position[0], inst.position[1], inst.position[2]]);
    }
    const positions = outlineEdgePositions(voxels, voxelSize);
    if (positions.length === 0) return null;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geom;
  }, [instances, voxelSize, selection]);

  if (!geometry) return null;
  return (
    <lineSegments renderOrder={2} geometry={geometry}>
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

  // Orbit state. Azimuth/elevation/distance are spherical coords
  // around `target`. Elevation is unclamped so the user can view the
  // scene from below as well as from above — placing cubes
  // underneath existing ones (or in free space below the visual
  // grid) requires being able to LOOK from below. Just a tiny
  // epsilon below the poles to avoid the lookAt degeneracy at ±π/2.
  const orbit = useRef({
    azimuth: -0.55,
    elevation: 0.45,
    distance: 16,
  });
  const dragMode = useRef<'none' | 'orbit' | 'pan'>('none');
  const dragLast = useRef({ x: 0, y: 0 });

  // Pannable target. Starts at the room's AABB centre; middle-drag
  // (or Shift+right-drag) translates it in screen-aligned axes. Held
  // in a ref so panning doesn't churn the React tree every frame.
  const target = useRef<THREE.Vector3>(new THREE.Vector3(0, 1, 0));
  const initialTarget = useMemo(() => {
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
    return new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);
  }, [compiled]);
  // Recenter when the room boots / loads (but NOT every time the
  // user pans — `target.current` persists). The initial value is
  // copied into `target.current` once per `initialTarget` change.
  useEffect(() => {
    target.current.copy(initialTarget);
  }, [initialTarget]);

  useEffect(() => {
    const canvas = gl.domElement;

    const onPointerDown = (e: PointerEvent) => {
      // Middle-button OR Shift+right = pan; bare right = orbit.
      // Left is reserved for tool actions handled elsewhere.
      if (e.button === 1) {
        dragMode.current = 'pan';
      } else if (e.button === 2) {
        dragMode.current = e.shiftKey ? 'pan' : 'orbit';
      } else {
        return;
      }
      dragLast.current = { x: e.clientX, y: e.clientY };
    };
    const onPointerMove = (e: PointerEvent) => {
      if (dragMode.current === 'none') return;
      const dx = e.clientX - dragLast.current.x;
      const dy = e.clientY - dragLast.current.y;
      dragLast.current = { x: e.clientX, y: e.clientY };
      if (dragMode.current === 'orbit') {
        const sens = 0.005;
        orbit.current.azimuth -= dx * sens;
        // Full elevation range (almost — the ±epsilon avoids the
        // pole singularity where lookAt's up vector degenerates).
        orbit.current.elevation = THREE.MathUtils.clamp(
          orbit.current.elevation - dy * sens,
          -Math.PI / 2 + 0.05,
          Math.PI / 2 - 0.05,
        );
      } else {
        // Pan: translate target perpendicular to the view direction.
        // Speed scales with distance so it stays usable when zoomed
        // way in or out.
        const speed = orbit.current.distance * 0.0015;
        const dir = new THREE.Vector3()
          .subVectors(persp.position, target.current)
          .normalize();
        const right = new THREE.Vector3()
          .crossVectors(persp.up, dir)
          .normalize();
        const up = new THREE.Vector3().crossVectors(dir, right).normalize();
        target.current.addScaledVector(right, -dx * speed);
        target.current.addScaledVector(up, dy * speed);
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 1 && e.button !== 2) return;
      dragMode.current = 'none';
    };
    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(e.deltaY * 0.001);
      orbit.current.distance = THREE.MathUtils.clamp(
        orbit.current.distance * factor,
        2,
        200,
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
      dragMode.current = 'none';
    };
  }, [gl, persp]);

  useFrame(() => {
    const { azimuth, elevation, distance } = orbit.current;
    const t = target.current;
    const cosE = Math.cos(elevation);
    const sinE = Math.sin(elevation);
    const cosA = Math.cos(azimuth);
    const sinA = Math.sin(azimuth);
    persp.position.set(
      t.x + distance * cosE * sinA,
      t.y + distance * sinE,
      t.z + distance * cosE * cosA,
    );
    persp.lookAt(t);
  });

  return null;
}

// --- Build-height plane (visual indicator) -----------------------

interface BuildHeightPlaneProps {
  buildHeight: number;
  voxelSize: number;
  visible: boolean;
}

/**
 * Faint grid-aligned plane rendered at the current build height so
 * the user can see where the Add / Tile tools will place cubes when
 * clicking on empty space. It's PURELY visual — picking goes through
 * the separate invisible `FloorPicker` mesh at the same height.
 *
 * Hidden when neither Add nor Tile is active so the Select / Delete
 * views aren't cluttered with a guide they're not using.
 */
function BuildHeightPlane({
  buildHeight,
  voxelSize,
  visible,
}: BuildHeightPlaneProps) {
  if (!visible) return null;
  const y = buildHeight * voxelSize;
  // Slight tint based on build-height sign so the user can tell at a
  // glance whether they're above or below the world's reference grid.
  const color = buildHeight === 0 ? '#fde68a' : buildHeight > 0 ? '#86efac' : '#f9a8d4';
  return (
    <group position={[0, y + 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <gridHelper
        args={[60, 30, color, color]}
        rotation={[Math.PI / 2, 0, 0]}
      />
      <mesh>
        <ringGeometry args={[0.6, 0.7, 24]} />
        <meshBasicMaterial color={color} transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

// --- Cubes layer (one InstancedMesh per kind, with picking) ------

interface CubesLayerProps {
  instances: ObjectInstance[];
  voxelSize: number;
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
  // Compose the shared <ObjectInstances> renderer with the editor's
  // tool dispatch. The wrapper <group>'s pointer events catch all
  // hits on any InstancedMesh ObjectInstances renders; we then read
  // `e.object.userData.kindId` + `e.instanceId` to look up which
  // cube was hit.
  //
  // Per-kind instance lookup: ObjectInstances groups instances by
  // kind internally, so the instanceId on the event is an index
  // into THAT kind's array — not into the flat snapshot. We mirror
  // ObjectInstances' grouping here so the lookup is `O(1)`.
  const instancesByKind = useMemo(() => {
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

  // cubeSize key is required by the SDK WorldObjects type — kept as-is.
  const worldObjects: WorldObjects = useMemo(
    () => ({ cubeSize: props.voxelSize, instances: props.instances }),
    [props.voxelSize, props.instances],
  );

  const lookupInstance = (
    e: ThreeEvent<PointerEvent>,
  ): ObjectInstance | null => {
    const obj = e.object as THREE.Object3D & {
      userData?: { kindId?: string; isObjectInstanceMesh?: boolean };
    };
    const kindId = obj.userData?.kindId;
    const idx = e.instanceId;
    if (!kindId || idx === undefined) return null;
    return instancesByKind.get(kindId)?.[idx] ?? null;
  };

  const { tool, onSelectInstance, onHoverCube, onHoverCommand, onAddClick, onDeleteClick, onTileClick } = props;

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    if (
      tool !== 'select' &&
      tool !== 'add' &&
      tool !== 'delete' &&
      tool !== 'tile'
    )
      return;
    const inst = lookupInstance(e);
    if (!inst) return;
    e.stopPropagation();
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
    const inst = lookupInstance(e);
    if (!inst) return;
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
    <group
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerOut={handlePointerOut}
    >
      <ObjectInstances worldObjects={worldObjects} />
    </group>
  );
}

// --- Floor picker (place-on-empty when Add tool is active) ------

interface FloorPickerProps {
  voxelSize: number;
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
  voxelSize,
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
    const v = snapToVoxel({ kind: 'floor', point }, voxelSize);
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
            x: voxel[0] * voxelSize,
            y: voxel[1] * voxelSize,
            z: voxel[2] * voxelSize,
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
        x: voxel[0] * voxelSize,
        y: voxel[1] * voxelSize,
        z: voxel[2] * voxelSize,
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
  const pickerWorldY = buildHeight * voxelSize + 0.01;
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

// --- Move tool controller (canvas-side, accesses camera + gl) ----

interface MoveControllerProps {
  tool: Tool;
  doc: RoomDocument;
  compiled: WorldObjects;
  selection: ReadonlySet<string>;
  moveState: MoveState;
  setMoveState: React.Dispatch<React.SetStateAction<MoveState>>;
  setMoveGhosts: React.Dispatch<React.SetStateAction<GhostSpec[]>>;
  onMoveSelection: (
    moves: Array<{ commandId: string; position: [number, number, number] }>,
  ) => void;
  onSelectInstance: (commandId: string, modKey: boolean) => void;
}

/**
 * Handles the move-tool pointer events. Mounted inside the R3F Canvas
 * so it can read `camera`, `gl`, and `raycaster` from `useThree`.
 *
 * Design:
 *   - pointerdown on a selected cube → start dragging; capture pointer
 *   - pointerdown on an unselected cube → call onSelectInstance, don't drag
 *   - pointermove → project onto XZ plane (or Y-axis plane if Shift),
 *     compute delta, compute proposed positions, check occupancy,
 *     emit ghost specs
 *   - pointerup → commit if 'ok', discard if 'blocked'
 *   - Esc → handled in the outer SceneEditorCanvas effect
 *
 * `import * as THREE` is legal here — this is a canvas file.
 */
function MoveController({
  tool,
  doc,
  compiled,
  selection,
  moveState,
  setMoveState,
  setMoveGhosts,
  onMoveSelection,
  onSelectInstance,
}: MoveControllerProps) {
  const { gl, camera, raycaster, pointer } = useThree();

  // Keep a ref to the latest state so the raw pointer listeners can
  // read it without closing over a stale version. These listeners are
  // added once and removed on cleanup.
  const stateRef = useRef(moveState);
  useEffect(() => { stateRef.current = moveState; }, [moveState]);

  const selectionRef = useRef(selection);
  useEffect(() => { selectionRef.current = selection; }, [selection]);

  const docRef = useRef(doc);
  useEffect(() => { docRef.current = doc; }, [doc]);

  const compiledRef = useRef(compiled);
  useEffect(() => { compiledRef.current = compiled; }, [compiled]);

  /** Project the current pointer onto the XZ plane at world Y = `planeY`.
   *  Returns voxel-space [x, y, z] snapped to integer grid, or null. */
  const projectXZ = useCallback(
    (clientX: number, clientY: number, planeY: number): Vec3 | null => {
      const canvas = gl.domElement;
      const rect = canvas.getBoundingClientRect();
      const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -(((clientY - rect.top) / rect.height) * 2 - 1);
      // Temporarily override the R3F pointer so raycaster picks up the
      // right NDC.
      const savedX = pointer.x;
      const savedY = pointer.y;
      pointer.x = nx;
      pointer.y = ny;
      raycaster.setFromCamera(pointer, camera);
      pointer.x = savedX;
      pointer.y = savedY;

      // Intersect with the horizontal plane at planeY.
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
      const hit = new THREE.Vector3();
      const ok = raycaster.ray.intersectPlane(plane, hit);
      if (!ok) return null;
      const vs = compiledRef.current.cubeSize;
      return [
        Math.round(hit.x / vs),
        Math.round(planeY / vs),
        Math.round(hit.z / vs),
      ];
    },
    [gl, camera, raycaster, pointer],
  );

  useEffect(() => {
    if (tool !== 'move') return;

    const canvas = gl.domElement;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      // Only act on left-button down.
      const doc = docRef.current;
      const sel = selectionRef.current;
      const cs = compiledRef.current.cubeSize; // SDK WorldObjects field name

      // Raycast to find which cube (if any) was hit.
      const rect = canvas.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      const savedX = pointer.x;
      const savedY = pointer.y;
      pointer.x = nx;
      pointer.y = ny;
      raycaster.setFromCamera(pointer, camera);
      pointer.x = savedX;
      pointer.y = savedY;

      // Hit-test all instances analytically (same AABB approach as
      // ContextMenuListener — fast and dependency-free).
      const half = cs / 2;
      let bestT = Infinity;
      let bestInst: ObjectInstance | null = null;
      for (const inst of compiledRef.current.instances) {
        const cx = inst.position[0] * cs;
        const cy = inst.position[1] * cs + cs / 2;
        const cz = inst.position[2] * cs;
        const t = rayHitAabb(
          raycaster.ray.origin,
          raycaster.ray.direction,
          [cx - half, cy - half, cz - half],
          [cx + half, cy + half, cz + half],
        );
        if (t !== null && t < bestT) {
          bestT = t;
          bestInst = inst;
        }
      }

      if (!bestInst) return; // no cube hit

      const commandId = bestInst.sourceCommandId;

      if (!sel.has(commandId)) {
        // Hit an unselected cube: select it, don't start drag.
        onSelectInstance(commandId, e.ctrlKey || e.metaKey);
        return;
      }

      // Hit a selected cube: start drag.
      e.stopPropagation();
      canvas.setPointerCapture(e.pointerId);

      // Collect original positions of all selected objects.
      const origPositions = new Map<string, Vec3>();
      for (const id of sel) {
        const cmd = doc.commands.find(
          (c) => c.id === id && c.op === 'placeCube',
        );
        if (cmd) {
          origPositions.set(
            id,
            (cmd as { position: Vec3 }).position,
          );
        }
      }

      // Use the first selected object's Y for the drag plane.
      const firstPos = origPositions.values().next().value as Vec3 | undefined;
      const planeWorldY = firstPos ? firstPos[1] * compiledRef.current.cubeSize : 0;

      // Derive the start voxel from the pointer position.
      const startVoxel = projectXZ(e.clientX, e.clientY, planeWorldY) ??
        (firstPos ? [...firstPos] as Vec3 : [0, 0, 0] as Vec3);

      setMoveState({
        stage: 'dragging',
        startVoxel,
        isYAxis: e.shiftKey,
        originalPositions: origPositions,
        proposedPositions: origPositions, // start at original
        occupancyResult: 'ok',
      });
    };

    const onPointerMove = (e: PointerEvent) => {
      const state = stateRef.current;
      if (state.stage !== 'dragging') return;

      const sel = selectionRef.current;
      const doc = docRef.current;
      const cs = compiledRef.current.cubeSize; // SDK WorldObjects field name

      let delta: Vec3;

      if (state.isYAxis || e.shiftKey) {
        // Y-axis drag: compute vertical screen delta from drag start.
        // We don't have a stored screen-Y anchor here; track via a
        // data attribute isn't available without a ref. Use a simpler
        // approach: re-derive from the proposed Y vs original Y.
        // For Y-axis drag we project onto a vertical plane instead.
        // Simpler: count pixels of vertical movement scaled to voxels.
        // We store the screen-Y of the startVoxel projected to screen.
        // Since we don't have it here, we project the start voxel to
        // screen and compare.
        const canvas = gl.domElement;
        const rect = canvas.getBoundingClientRect();
        // Project startVoxel to screen.
        const startWorld = new THREE.Vector3(
          state.startVoxel[0] * cs,
          state.startVoxel[1] * cs + cs / 2,
          state.startVoxel[2] * cs,
        );
        const proj = startWorld.clone().project(camera as THREE.PerspectiveCamera);
        const startScreenY = ((proj.y - 1) / -2) * rect.height + rect.top;
        const PIXELS_PER_VOXEL = 28;
        const dy = Math.round((startScreenY - e.clientY) / PIXELS_PER_VOXEL);
        delta = [0, dy, 0];
      } else {
        // XZ plane drag.
        // Use the Y from the original positions (first selected).
        const firstEntry = state.originalPositions.entries().next().value as [string, Vec3] | undefined;
        const origY = firstEntry ? firstEntry[1][1] : 0;
        const planeWorldY = origY * cs;
        const currentVoxel = projectXZ(e.clientX, e.clientY, planeWorldY);
        if (!currentVoxel) return;
        delta = [
          currentVoxel[0] - state.startVoxel[0],
          0,
          currentVoxel[2] - state.startVoxel[2],
        ];
      }

      const proposed = computeMovedPositions(doc, sel, delta);
      if (!proposed) return;

      const occupancyResult = checkMoveOccupancy(doc, sel, proposed);

      setMoveState((prev) =>
        prev.stage === 'dragging'
          ? { ...prev, proposedPositions: proposed, occupancyResult }
          : prev,
      );

      // Emit ghost specs for each proposed position.
      const mode = occupancyResult === 'ok' ? 'solid' : 'blocked';
      const newGhosts: GhostSpec[] = [];
      for (const [cmdId, pos] of proposed.entries()) {
        // Find the kindId for this command.
        const inst = compiledRef.current.instances.find(
          (i) => i.sourceCommandId === cmdId,
        );
        if (inst) {
          newGhosts.push({ mode, kindId: inst.kindId, voxel: pos });
        }
      }
      setMoveGhosts(newGhosts);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const state = stateRef.current;
      if (state.stage !== 'dragging') return;

      canvas.releasePointerCapture(e.pointerId);
      setMoveGhosts([]);
      setMoveState({ stage: 'idle' });

      if (state.occupancyResult === 'blocked') {
        // Discard — no mutation.
        return;
      }

      // Commit the move.
      const moves = Array.from(state.proposedPositions.entries()).map(
        ([commandId, position]) => ({ commandId, position }),
      );
      onMoveSelection(moves);
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [
    tool,
    gl,
    camera,
    raycaster,
    pointer,
    projectXZ,
    onSelectInstance,
    onMoveSelection,
    setMoveState,
    setMoveGhosts,
  ]);

  return null;
}
