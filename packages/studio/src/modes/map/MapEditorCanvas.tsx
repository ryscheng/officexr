import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Sky, Stars } from '@react-three/drei';
import {
  type MapDocumentV1,
  type RoomDocument,
  type RoomInstance,
  type SpawnPoint,
} from '@officexr/world/scenes';
import { useApplication, useCatalogReady } from '@officexr/world/react';
import {
  BakedLayout,
  DEFAULT_EDITOR_LIGHTING,
  EndlessGrid,
  LightingRig,
  ObjectInstances,
  VOXEL_SIZE,
  type LightingSettings,
} from '@officexr/world/renderer';
import type { WorldObjects } from '@officexr/sdk';
import type { MapSelection } from './useMapDocument.ts';
import type { MapTool } from './mapTools.ts';
import { resolveRoomPointerAction } from './mapPointerActions.ts';
import { CanvasFrameStats } from '../../perf/CanvasFrameStats.tsx';
import {
  snapRoomToNeighbors,
  type RoomAABBVoxel,
} from './roomBoundarySnap.ts';

/**
 * Snap threshold (in voxels) for room-to-room boundary alignment
 * during a Move-tool drag. 2 voxels = 4 m at the default
 * VOXEL_SIZE=2 — comfortable but not aggressive. See
 * `roomBoundarySnap.ts` for the candidate algebra.
 */
const ROOM_SNAP_THRESHOLD_VOXELS = 2;

/**
 * Translate the map document's `MapEnvironment` (sun position +
 * color + intensity + ambient intensity) into the renderer's
 * `LightingSettings` shape. The map editor's environment panel
 * only exposes the sun + ambient fields; the rest pick up the
 * editor defaults (no shadow casting, no sun disc, no aux light).
 */
function mapDocToLighting(
  env: import('@officexr/world/scenes').MapEnvironment,
): LightingSettings {
  return {
    ...DEFAULT_EDITOR_LIGHTING,
    sunPosition: [
      env.sun.positionX,
      env.sun.positionY,
      env.sun.positionZ,
    ],
    sunColor: env.sun.color,
    sunIntensity: env.sun.intensity,
    ambientFillIntensity: env.ambientIntensity,
  };
}

interface MapEditorCanvasProps {
  doc: MapDocumentV1;
  rooms: ReadonlyMap<string, RoomDocument>;
  selection: MapSelection;
  onSelect: (sel: MapSelection) => void;
  onMoveRoom: (id: string, position: [number, number, number]) => void;
  onPlaceSpawn: (position: [number, number, number]) => void;
  /** Active map-editor tool — Select / Move / Spawn. Determines what
   * a pointer-down on a room or on the floor does. */
  tool: MapTool;
}

/**
 * R3F canvas for the Map editor. Composes:
 *   - a free-fly camera (orbit + WASD pan + scroll zoom)
 *   - per-`RoomInstance` group with the compiled cubes rendered as an
 *     InstancedMesh (one mesh per kind)
 *   - per-instance AABB outline that shows the selected room
 *   - draggable handle on the selected room (left-drag on the cube
 *     mesh) that moves the room across the y=0 grid
 *   - spawn marker glyphs at every `SpawnPoint`
 *   - an invisible floor that catches "Add spawn" clicks
 *
 * The whole thing uses the `useCubeCatalog` hook so material edits
 * from the Object editor show up live.
 */
export function MapEditorCanvas(props: MapEditorCanvasProps) {
  return (
    <Canvas
      camera={{ position: [30, 30, 30], fov: 50, near: 0.1, far: 1000 }}
      style={{ width: '100%', height: '100%', display: 'block' }}
      shadows={false}
    >
      <CanvasFrameStats />
      <color attach="background" args={['#0b1220']} />
      <LightingRig lighting={mapDocToLighting(props.doc.environment)} />
      <EnvironmentLayer environment={props.doc.environment} />
      <EndlessGrid />
      <FloorPicker
        onPlaceSpawn={props.onPlaceSpawn}
        onDeselect={() => props.onSelect(null)}
        tool={props.tool}
      />
      <RoomsLayer
        instances={props.doc.rooms}
        rooms={props.rooms}
        selection={props.selection}
        onSelect={props.onSelect}
        onMove={props.onMoveRoom}
        tool={props.tool}
        onPlaceSpawn={props.onPlaceSpawn}
      />
      <SpawnLayer
        spawns={props.doc.spawnPoints}
        selection={props.selection}
        onSelect={props.onSelect}
      />
      <FlyCamera />
    </Canvas>
  );
}

// --- Environment (drei Sky + Stars + Environment HDRI) ----------

interface EnvironmentLayerProps {
  environment: import('@officexr/world/scenes').MapEnvironment;
}

/**
 * Conditionally mounts drei's Sky / Stars / Environment based on the
 * map's `MapEnvironment` block. Each section is independent — a map
 * can have Stars without Sky and HDRI without either.
 *
 * The Environment preset name is round-tripped through `hdri.url`;
 * `environment-presets.ts` is the source of truth for the allowed
 * preset slugs. `'none'` is the explicit "no preset" sentinel and
 * collapses to `hdri = null` in the document, so it never reaches
 * this component.
 */
function EnvironmentLayer({ environment }: EnvironmentLayerProps) {
  const { sky, stars, hdri } = environment;
  // drei's <Sky> wants a sunPosition vector — derive from
  // inclination/azimuth so the user's sliders matter even when the
  // sun is shadow-cast from the same direction by `directionalLight`
  // above. We DELIBERATELY don't try to keep these locked together —
  // the user might want a dramatic backlight where the sun-shadow
  // direction and the sky's bright spot disagree.
  return (
    <>
      {sky?.enabled ? (
        <Sky
          turbidity={sky.turbidity}
          rayleigh={sky.rayleigh}
          inclination={sky.inclination}
          azimuth={sky.azimuth}
        />
      ) : null}
      {stars?.enabled ? (
        <Stars
          radius={stars.radius}
          depth={stars.depth}
          count={stars.count}
          factor={stars.factor}
          saturation={stars.saturation}
          fade={stars.fade}
        />
      ) : null}
      {hdri ? (
        <Environment
          // The doc stash the preset name in `url` (see
          // `environment-presets.ts` for the rationale). When the
          // schema grows to support uploaded HDRs, switch to
          // `files={hdri.url}` when it looks like a URL.
          preset={hdri.url as any}
          environmentIntensity={hdri.intensity}
          background={hdri.background}
        />
      ) : null}
    </>
  );
}

// --- Floor (invisible spawn picker + click-to-deselect) ----------

interface FloorPickerProps {
  onPlaceSpawn: (position: [number, number, number]) => void;
  onDeselect: () => void;
  tool: MapTool;
}

/**
 * A 1000×1000 invisible plane at y=0 that catches click events the
 * cubes / spawn markers didn't consume. Behavior depends on the tool:
 *   - **select / move**: clear the selection (matches the
 *     "click empty space to deselect" convention from the Room editor).
 *   - **spawn**: NO-OP. Spawns must land on a room surface, so a click
 *     that fell all the way through to the floor (no room beneath the
 *     cursor) is rejected.
 *
 * The plane has to be large enough that a wide-FOV fly camera always
 * has it in frame; 1000 units = 500 voxels = bigger than any realistic
 * map.
 */
function FloorPicker({ onPlaceSpawn: _onPlaceSpawn, onDeselect, tool }: FloorPickerProps) {
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0, 0]}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        // Spawn tool: ignore empty-ground clicks; spawns are
        // room-surface-only by design.
        if (tool === 'spawn') return;
        onDeselect();
      }}
    >
      <planeGeometry args={[1000, 1000]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  );
}

// --- Rooms ------------------------------------------------------

export interface RoomsLayerProps {
  instances: readonly RoomInstance[];
  rooms: ReadonlyMap<string, RoomDocument>;
  selection: MapSelection;
  onSelect: (sel: MapSelection) => void;
  onMove: (id: string, position: [number, number, number]) => void;
  tool: MapTool;
  /** Spawn-tool drop callback. Receives the raw raycast world-space
   *  hit point — Y is the surface Y, so spawn markers land on cube
   *  tops or on a baked-layout surface naturally. */
  onPlaceSpawn: (position: [number, number, number]) => void;
}

/**
 * Renders one `<RoomInstanceMesh>` per placed room. Exported (alongside
 * the component itself) so editor-scenario tests can mount the room
 * scene subtree under `@react-three/test-renderer` without the DOM
 * chrome — `MapEditorCanvas` returns a `<Canvas>`, which the test
 * renderer can't host.
 */
export function RoomsLayer(props: RoomsLayerProps) {
  const { geometry: geomService, rooms: roomService } = useApplication();
  const catalogReady = useCatalogReady();

  // Precompute each room instance's world voxel AABB by uniting the
  // voxelFootprints of its compiled cubes, rotating by rotationY, then
  // offsetting by the instance's voxel position. This is the data the
  // Move-tool snap needs from every NON-moving room. Memoized on
  // doc.rooms + the room library so the cost is paid once per
  // selection/library mutation, not per drag frame.
  const allAabbs = useMemo<readonly RoomAABBVoxel[]>(() => {
    if (!catalogReady) return [];
    const out: RoomAABBVoxel[] = [];
    for (const ri of props.instances) {
      const room = props.rooms.get(ri.roomName);
      if (!room) continue;
      const compiled = roomService.compileScene(room);
      if (compiled.instances.length === 0) continue;
      // Compute the room-local voxel AABB by unioning each cube's
      // voxelFootprint.
      let minX = Infinity,
        minY = Infinity,
        minZ = Infinity;
      let maxX = -Infinity,
        maxY = -Infinity,
        maxZ = -Infinity;
      for (const cube of compiled.instances) {
        const fp = geomService.voxelFootprint(cube.position, cube.kindId);
        if (fp.min[0] < minX) minX = fp.min[0];
        if (fp.min[1] < minY) minY = fp.min[1];
        if (fp.min[2] < minZ) minZ = fp.min[2];
        if (fp.max[0] - 1 > maxX) maxX = fp.max[0] - 1; // VoxelFootprint.max is exclusive
        if (fp.max[1] - 1 > maxY) maxY = fp.max[1] - 1;
        if (fp.max[2] - 1 > maxZ) maxZ = fp.max[2] - 1;
      }
      // Rotate the X/Z extents by rotationY * 90°. Y is unaffected.
      const rot = ((ri.rotationY ?? 0) % 4) as 0 | 1 | 2 | 3;
      const rotated = rotateXZ({ minX, minZ, maxX, maxZ }, rot);
      // Offset by the room instance's voxel position.
      const [px, py, pz] = ri.position;
      out.push({
        id: ri.id,
        min: [rotated.minX + px, minY + py, rotated.minZ + pz],
        max: [rotated.maxX + px, maxY + py, rotated.maxZ + pz],
      });
    }
    return out;
  }, [props.instances, props.rooms, geomService, roomService, catalogReady]);

  return (
    <>
      {props.instances.map((ri) => {
        const room = props.rooms.get(ri.roomName);
        const isSelected =
          props.selection !== null &&
          props.selection.kind === 'room' &&
          props.selection.id === ri.id;
        const selfAabb = allAabbs.find((a) => a.id === ri.id) ?? null;
        const neighborAabbs = allAabbs.filter((a) => a.id !== ri.id);
        return (
          <RoomInstanceMesh
            key={ri.id}
            instance={ri}
            room={room}
            selected={isSelected}
            onSelect={() => props.onSelect({ kind: 'room', id: ri.id })}
            onMove={(pos) => props.onMove(ri.id, pos)}
            tool={props.tool}
            onPlaceSpawn={props.onPlaceSpawn}
            selfAabb={selfAabb}
            neighborAabbs={neighborAabbs}
          />
        );
      })}
    </>
  );
}

/** Rotate an XZ-axis-aligned voxel rectangle by `rot * 90°` (Y axis,
 *  right-handed). Used to convert a room's local AABB into the AABB
 *  it occupies after `rotationY` is applied. */
function rotateXZ(
  rect: { minX: number; minZ: number; maxX: number; maxZ: number },
  rot: 0 | 1 | 2 | 3,
): { minX: number; minZ: number; maxX: number; maxZ: number } {
  const { minX, minZ, maxX, maxZ } = rect;
  // The four corners of the original rectangle.
  const corners: [number, number][] = [
    [minX, minZ],
    [maxX, minZ],
    [minX, maxZ],
    [maxX, maxZ],
  ];
  // Y-axis rotation matrix in XZ (right-handed): (x,z) → rotated.
  // Note: voxel coords are inclusive integer indices; after rotation
  // we re-union the corners to recover the new axis-aligned AABB.
  const rotated = corners.map(([x, z]) => {
    switch (rot) {
      case 0:
        return [x, z];
      case 1:
        return [-z, x]; // 90° CCW about Y
      case 2:
        return [-x, -z];
      case 3:
        return [z, -x];
    }
  });
  let rMinX = Infinity,
    rMinZ = Infinity,
    rMaxX = -Infinity,
    rMaxZ = -Infinity;
  for (const [x, z] of rotated) {
    if (x < rMinX) rMinX = x;
    if (x > rMaxX) rMaxX = x;
    if (z < rMinZ) rMinZ = z;
    if (z > rMaxZ) rMaxZ = z;
  }
  return { minX: rMinX, minZ: rMinZ, maxX: rMaxX, maxZ: rMaxZ };
}

interface RoomInstanceMeshProps {
  instance: RoomInstance;
  room: RoomDocument | undefined;
  selected: boolean;
  onSelect: () => void;
  onMove: (position: [number, number, number]) => void;
  tool: MapTool;
  onPlaceSpawn: (position: [number, number, number]) => void;
  /** Room's own world voxel AABB at its current position (null until
   *  the catalog is ready). The Move tool re-bases this each drag
   *  frame against the cursor's proposed voxel position. */
  selfAabb: RoomAABBVoxel | null;
  /** Every other room's world voxel AABB. Used by the Move tool to
   *  snap the moving room's faces to a neighbor's. */
  neighborAabbs: readonly RoomAABBVoxel[];
}

/**
 * Renders one `RoomInstance` as a translated/rotated group around the
 * shared `<ObjectInstances>` renderer. Click handlers dispatch
 * selection; drag (left-pointer-down → move) translates the room
 * across the y=0 grid snapping each dragged frame to integer voxel
 * coords.
 *
 * The room's `compileScene` output is converted to a `WorldObjects`
 * snapshot and fed to `<ObjectInstances worldObjects={…} />`. The
 * editor no longer owns the per-kind InstancedMesh allocation, the
 * geometry/material extraction, or the per-instance matrix
 * composition — that's all in the renderer package now and shared
 * with Debug/Mugshot/Room.
 *
 * Why per-room mount instead of one flat snapshot for the whole map:
 * each `RoomInstance` carries its own `rotationY` (0/90/180/270°).
 * KayKit cubes have orientation-specific bevels, so the rotation has
 * to live on a parent `<group>` rather than be pre-baked into per-
 * instance positions. Cross-room kind batching is a future
 * optimization (mesh merging of contiguous same-kind runs); not in
 * scope for the unification.
 */
function RoomInstanceMesh({
  instance,
  room,
  selected,
  onSelect,
  onMove,
  tool,
  onPlaceSpawn,
  selfAabb,
  neighborAabbs,
}: RoomInstanceMeshProps) {
  // Wait for the catalog bootstrap before compiling. Without this gate,
  // getKindStride falls back to [1,1,1] for every kind on the first
  // paint — and any extrude or per-kind-stride placement compiles into
  // overlapping cubes (most visibly on the platform / long_corridor).
  const catalogReady = useCatalogReady();
  const { rooms: roomService, geometry: geomService } = useApplication();
  const compiled = useMemo(() => {
    if (!room || !catalogReady) return null;
    return roomService.compileScene(room);
  }, [room, catalogReady, roomService]);

  const worldObjects: WorldObjects | null = useMemo(() => {
    if (!compiled) return null;
    return {
      cubeSize: VOXEL_SIZE,
      instances: compiled.instances,
    };
  }, [compiled]);

  // Drag state. Move tool only — Select/Spawn tools never enter
  // drag mode. The drag starts on the room's group pointer-down and
  // tracks the cursor on a y=0 plane, snapping the room's anchor to
  // integer voxel coords. After the grid snap we additionally try to
  // align the moving room's voxel AABB to any neighbor AABB face
  // within `ROOM_SNAP_THRESHOLD_VOXELS` — that's what gives the
  // "rooms click together" feel the Map editor wants.
  const { camera, gl, raycaster, pointer } = useThree();
  const dragging = useRef(false);
  const dragStartOffset = useRef<[number, number, number]>([0, 0, 0]);

  // Refs so the pointer-move handler always reads the latest props
  // without re-binding listeners on every render.
  const selfAabbRef = useRef(selfAabb);
  const neighborAabbsRef = useRef(neighborAabbs);
  const instancePosRef = useRef(instance.position);
  selfAabbRef.current = selfAabb;
  neighborAabbsRef.current = neighborAabbs;
  instancePosRef.current = instance.position;

  useEffect(() => {
    const handlePointerMove = () => {
      if (!dragging.current) return;
      raycaster.setFromCamera(pointer, camera);
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const point = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(plane, point)) return;
      // Step 1: grid-snap the proposed room anchor so cubes stay on
      // integer voxel coords after the cursor offset is applied.
      let vx = Math.round((point.x - dragStartOffset.current[0]) / VOXEL_SIZE);
      let vz = Math.round((point.z - dragStartOffset.current[2]) / VOXEL_SIZE);

      // Step 2: AABB snap to neighbors. Translate the room's selfAabb
      // by the proposed (vx, vz) - currentPosition delta, then ask
      // snapRoomToNeighbors for a corrective (dx, dz) within
      // threshold.
      const self = selfAabbRef.current;
      const neighbors = neighborAabbsRef.current;
      if (self && neighbors.length > 0) {
        const curPos = instancePosRef.current;
        const tx = vx - curPos[0];
        const tz = vz - curPos[2];
        const proposed: RoomAABBVoxel = {
          id: self.id,
          min: [self.min[0] + tx, self.min[1], self.min[2] + tz],
          max: [self.max[0] + tx, self.max[1], self.max[2] + tz],
        };
        const { dx, dz } = snapRoomToNeighbors(
          proposed,
          neighbors,
          ROOM_SNAP_THRESHOLD_VOXELS,
        );
        vx += dx;
        vz += dz;
      }

      onMove([vx, instance.position[1], vz]);
    };
    const handlePointerUp = () => {
      dragging.current = false;
    };
    const dom = gl.domElement;
    dom.addEventListener('pointermove', handlePointerMove);
    dom.addEventListener('pointerup', handlePointerUp);
    return () => {
      dom.removeEventListener('pointermove', handlePointerMove);
      dom.removeEventListener('pointerup', handlePointerUp);
    };
  }, [camera, gl, instance.position, onMove, pointer, raycaster]);

  // Local-space AABB for the selection outline. Computed in voxel
  // space then converted to world units; only depends on the room's
  // own cubes, not the placement.
  //
  // Previously this used voxelSize/2 half-extents and a +vs/2 Y
  // offset — the legacy "1 cube = 1 voxel" math that produced
  // mis-sized selection boxes for any kind larger than one voxel.
  // Now driven by `geomService.worldAABB` so the room's bounds match
  // the rendered mesh AABB union exactly.
  const bounds = useMemo(() => {
    if (!compiled || compiled.instances.length === 0) return null;
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const inst of compiled.instances) {
      const aabb = geomService.worldAABB(inst.position, inst.kindId);
      for (let a = 0; a < 3; a++) {
        if (aabb.min[a] < min[a]) min[a] = aabb.min[a];
        if (aabb.max[a] > max[a]) max[a] = aabb.max[a];
      }
    }
    return { min, max };
  }, [compiled, geomService]);

  const groupPos: [number, number, number] = [
    instance.position[0] * VOXEL_SIZE,
    instance.position[1] * VOXEL_SIZE,
    instance.position[2] * VOXEL_SIZE,
  ];

  if (!room) {
    // Missing room — render a placeholder box so the author can see
    // the instance and either delete it or save the missing room.
    return (
      <group position={groupPos}>
        <mesh
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            // Missing-room placeholder: no drag (we have no compiled
            // AABB), but spawn + select still route via the shared
            // decision so behavior matches a real room.
            if (resolveRoomPointerAction(tool) === 'place-spawn') {
              // Use the raw raycast hit Y — the surface of whatever
              // was clicked. Voxel-rounding is intentionally gone:
              // baked layouts may have non-voxel-aligned surfaces.
              onPlaceSpawn([e.point.x, e.point.y, e.point.z]);
              return;
            }
            onSelect();
          }}
        >
          <boxGeometry args={[VOXEL_SIZE * 2, VOXEL_SIZE, VOXEL_SIZE * 2]} />
          <meshStandardMaterial color="#7c2d12" wireframe />
        </mesh>
      </group>
    );
  }

  const rotationY = (instance.rotationY ?? 0) * (Math.PI / 2);

  // Wrap <ObjectInstances> in a <group> that:
  //   - applies the room's world transform (position + rotationY)
  //   - catches pointer events from any of the rendered
  //     InstancedMeshes (R3F bubbles pointer events up the scene
  //     graph). Without the wrapper group, we'd need to wire
  //     per-kind onPointerDown handlers through ObjectInstances'
  //     prop surface — leakier and editor-specific.
  // Derive baked-layout path from the room's layoutName (if set). The
  // Map view renders full room geometry, so each room instance should
  // also show its structural GLB at the same world transform.
  const bakedLayoutPath = room.layoutName
    ? `/api/baked-layouts/${encodeURIComponent(room.layoutName)}`
    : undefined;

  return (
    <group
      position={groupPos}
      rotation={[0, rotationY, 0]}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        // Any pointer-down on a descendant of this group counts —
        // cube InstancedMesh OR a BakedLayout mesh. The previous
        // gate that required `userData.isObjectInstanceMesh` broke
        // drag + spawn the moment a room started rendering its baked
        // layout in front of the raw cubes.
        e.stopPropagation();
        const action = resolveRoomPointerAction(tool);
        if (action === 'place-spawn') {
          // Spawn tool: drop at the raw raycast hit. `e.point.y` is
          // the actual surface Y from R3F's raycaster — works for
          // both cube tops and baked-layout surfaces.
          onPlaceSpawn([e.point.x, e.point.y, e.point.z]);
          return;
        }
        // Select OR Move: select the room. The Move tool also kicks
        // off a drag in the same gesture so the user doesn't have to
        // click twice.
        onSelect();
        if (action === 'select-drag') {
          // Capture the raycast hit's offset from the room anchor so
          // the room doesn't jump its centre to the cursor on drag.
          dragStartOffset.current = [
            e.point.x - groupPos[0],
            0,
            e.point.z - groupPos[2],
          ];
          dragging.current = true;
        }
      }}
    >
      {bakedLayoutPath && room.layoutName ? (
        <BakedLayout
          gltfPath={bakedLayoutPath}
          layoutName={room.layoutName}
        />
      ) : null}
      {worldObjects ? <ObjectInstances worldObjects={worldObjects} /> : null}
      {selected && bounds ? <SelectionOutline min={bounds.min} max={bounds.max} /> : null}
    </group>
  );
}

// --- Selection outline (yellow wireframe AABB) ------------------

function SelectionOutline({
  min,
  max,
}: {
  min: [number, number, number];
  max: [number, number, number];
}) {
  const size: [number, number, number] = [
    max[0] - min[0],
    max[1] - min[1],
    max[2] - min[2],
  ];
  const center: [number, number, number] = [
    (max[0] + min[0]) / 2,
    (max[1] + min[1]) / 2,
    (max[2] + min[2]) / 2,
  ];
  const geom = useMemo(() => {
    const box = new THREE.BoxGeometry(size[0], size[1], size[2]);
    const edges = new THREE.EdgesGeometry(box);
    box.dispose();
    return edges;
  }, [size[0], size[1], size[2]]);
  return (
    <lineSegments position={center} geometry={geom}>
      <lineBasicMaterial color="#fde047" linewidth={2} />
    </lineSegments>
  );
}

// --- Spawn markers ----------------------------------------------

interface SpawnLayerProps {
  spawns: readonly SpawnPoint[];
  selection: MapSelection;
  onSelect: (sel: MapSelection) => void;
}

// Marker geometry — cone is `SPAWN_CONE_HEIGHT` tall. The cone's
// origin in three.js is its centroid (height/2 above the base), so
// the marker is positioned with `y = SPAWN_CONE_HEIGHT/2` to put the
// base flush with `s.position`. The spawn position represents the
// player's foot, so the marker must visually rest *on* that point
// rather than be centered through the surface.
const SPAWN_CONE_HEIGHT = 1.6;
const SPAWN_CONE_RADIUS = 0.6;
const SPAWN_SPHERE_OFFSET = SPAWN_CONE_HEIGHT + 0.1; // tip sphere

function SpawnLayer({ spawns, selection, onSelect }: SpawnLayerProps) {
  return (
    <>
      {spawns.map((s) => {
        const isSelected =
          selection !== null && selection.kind === 'spawn' && selection.id === s.id;
        return (
          <group key={s.id} position={s.position}>
            <mesh
              position={[0, SPAWN_CONE_HEIGHT / 2, 0]}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                onSelect({ kind: 'spawn', id: s.id });
              }}
            >
              <coneGeometry args={[SPAWN_CONE_RADIUS, SPAWN_CONE_HEIGHT, 8]} />
              <meshStandardMaterial
                color={isSelected ? '#fde047' : '#22d3ee'}
                emissive={isSelected ? '#fde047' : '#0e7490'}
                emissiveIntensity={0.6}
              />
            </mesh>
            <mesh position={[0, SPAWN_SPHERE_OFFSET, 0]}>
              <sphereGeometry args={[0.18, 8, 8]} />
              <meshBasicMaterial color={isSelected ? '#fef9c3' : '#cffafe'} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

// --- Fly camera --------------------------------------------------

function FlyCamera() {
  const { camera, gl } = useThree();
  const persp = camera as THREE.PerspectiveCamera;

  // Orbit-style camera with WASD pan + scroll dolly. Anchor point is
  // a `target` in world coords; right-drag rotates around it; WASD
  // moves the target across the y=0 plane in the camera's local
  // forward/right.
  const orbit = useRef({ azimuth: -0.55, elevation: 0.7, distance: 60 });
  const target = useRef(new THREE.Vector3(0, 0, 0));
  const dragMode = useRef<'none' | 'orbit' | 'pan'>('none');
  const dragLast = useRef({ x: 0, y: 0 });
  const keys = useRef<Record<string, boolean>>({});

  useEffect(() => {
    const dom = gl.domElement;
    const onDown = (e: PointerEvent) => {
      if (e.button === 1) {
        dragMode.current = 'pan';
      } else if (e.button === 2) {
        dragMode.current = e.shiftKey ? 'pan' : 'orbit';
      } else {
        return;
      }
      dragLast.current = { x: e.clientX, y: e.clientY };
    };
    const onMove = (e: PointerEvent) => {
      if (dragMode.current === 'none') return;
      const dx = e.clientX - dragLast.current.x;
      const dy = e.clientY - dragLast.current.y;
      dragLast.current = { x: e.clientX, y: e.clientY };
      if (dragMode.current === 'orbit') {
        const sens = 0.005;
        orbit.current.azimuth -= dx * sens;
        orbit.current.elevation = THREE.MathUtils.clamp(
          orbit.current.elevation - dy * sens,
          -Math.PI / 2 + 0.05,
          Math.PI / 2 - 0.05,
        );
      } else {
        const speed = orbit.current.distance * 0.0015;
        const dir = new THREE.Vector3()
          .subVectors(persp.position, target.current)
          .normalize();
        const right = new THREE.Vector3().crossVectors(persp.up, dir).normalize();
        const up = new THREE.Vector3().crossVectors(dir, right).normalize();
        target.current.addScaledVector(right, -dx * speed);
        target.current.addScaledVector(up, dy * speed);
      }
    };
    const onUp = (e: PointerEvent) => {
      if (e.button !== 1 && e.button !== 2) return;
      dragMode.current = 'none';
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(e.deltaY * 0.001);
      orbit.current.distance = THREE.MathUtils.clamp(
        orbit.current.distance * factor,
        4,
        500,
      );
    };
    const onContext = (e: MouseEvent) => e.preventDefault();
    const onKeyDown = (e: KeyboardEvent) => {
      // Skip when typing into an input/textarea/leva.
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      )
        return;
      keys.current[e.key.toLowerCase()] = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keys.current[e.key.toLowerCase()] = false;
    };

    dom.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    dom.addEventListener('wheel', onWheel, { passive: false });
    dom.addEventListener('contextmenu', onContext);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      dom.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      dom.removeEventListener('wheel', onWheel);
      dom.removeEventListener('contextmenu', onContext);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [gl, persp]);

  useFrame((_, dt) => {
    // WASD: move the target across the y=0 plane in the camera's
    // local forward/right. Scaled by the orbit distance so the same
    // keypress feels right at both zoom-in and zoom-out.
    const speed = orbit.current.distance * dt * 1.2;
    const forward = new THREE.Vector3()
      .subVectors(target.current, persp.position);
    forward.y = 0;
    if (forward.lengthSq() > 0) forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
    if (right.lengthSq() > 0) right.normalize();
    if (keys.current['w']) target.current.addScaledVector(forward, speed);
    if (keys.current['s']) target.current.addScaledVector(forward, -speed);
    if (keys.current['a']) target.current.addScaledVector(right, -speed);
    if (keys.current['d']) target.current.addScaledVector(right, speed);
    if (keys.current['q']) target.current.y -= speed;
    if (keys.current['e']) target.current.y += speed;

    const { azimuth, elevation, distance } = orbit.current;
    const cosE = Math.cos(elevation);
    persp.position.set(
      target.current.x + distance * cosE * Math.sin(azimuth),
      target.current.y + distance * Math.sin(elevation),
      target.current.z + distance * cosE * Math.cos(azimuth),
    );
    persp.lookAt(target.current);
  });

  return null;
}
