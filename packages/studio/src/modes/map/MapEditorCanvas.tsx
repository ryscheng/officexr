import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Sky, Stars } from '@react-three/drei';
import {
  compileScene,
  getKindStride,
  useCatalogReady,
  type MapDocumentV1,
  type RoomDocument,
  type RoomInstance,
  type SpawnPoint,
} from '@officexr/world/scenes';
import {
  DEFAULT_EDITOR_LIGHTING,
  EndlessGrid,
  LightingRig,
  ObjectInstances,
  VOXEL_SIZE,
  type LightingSettings,
} from '@officexr/world/renderer';
import type { WorldObjects } from '@officexr/sdk';
import type { MapSelection } from './useMapDocument.ts';

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

/**
 * Snap a raycast hit point to the nearest voxel-grid Y level so a
 * spawn marker lands on a voxel top (or on the floor at y=0) instead
 * of inside voxel geometry. Voxel bottoms sit on `y = k * VOXEL_SIZE`
 * for integer k, so:
 *   - hit on a voxel top (y = VOXEL_SIZE) → unchanged.
 *   - hit on the floor (y = 0)            → unchanged.
 *   - hit on a voxel side (e.g. y=1.5)   → rounded to the nearest
 *                                           grid level (y=2 here).
 * X/Z are passed through; the caller decides whether to further
 * grid-snap those (spawn points are continuous in X/Z by design).
 */
function snapToCubeTop(hit: { x: number; y: number; z: number }): [
  number,
  number,
  number,
] {
  return [hit.x, Math.round(hit.y / VOXEL_SIZE) * VOXEL_SIZE, hit.z];
}

interface MapEditorCanvasProps {
  doc: MapDocumentV1;
  rooms: ReadonlyMap<string, RoomDocument>;
  selection: MapSelection;
  onSelect: (sel: MapSelection) => void;
  onMoveRoom: (id: string, position: [number, number, number]) => void;
  onPlaceSpawn: (position: [number, number, number]) => void;
  /** True while the "Add spawn" tool is active. Click on the floor
   * places a spawn rather than deselecting. */
  spawnToolActive: boolean;
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
      <color attach="background" args={['#0b1220']} />
      <LightingRig lighting={mapDocToLighting(props.doc.environment)} />
      <EnvironmentLayer environment={props.doc.environment} />
      <EndlessGrid />
      <FloorPicker
        onPlaceSpawn={props.onPlaceSpawn}
        onDeselect={() => props.onSelect(null)}
        spawnToolActive={props.spawnToolActive}
      />
      <RoomsLayer
        instances={props.doc.rooms}
        rooms={props.rooms}
        selection={props.selection}
        onSelect={props.onSelect}
        onMove={props.onMoveRoom}
        spawnToolActive={props.spawnToolActive}
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
  spawnToolActive: boolean;
}

/**
 * A 1000×1000 invisible plane at y=0 that catches click events the
 * cubes / spawn markers didn't consume. Behavior depends on the tool:
 *   - spawn tool active → place a new spawn at the world-space hit
 *   - otherwise → clear the selection (matches the "click empty
 *     space to deselect" convention from the Room editor).
 *
 * The plane has to be large enough that a wide-FOV fly camera always
 * has it in frame; 1000 units = 500 voxels = bigger than any realistic
 * map.
 */
function FloorPicker({ onPlaceSpawn, onDeselect, spawnToolActive }: FloorPickerProps) {
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0, 0]}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        if (spawnToolActive) {
          onPlaceSpawn([e.point.x, 0, e.point.z]);
        } else {
          onDeselect();
        }
      }}
    >
      <planeGeometry args={[1000, 1000]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  );
}

// --- Rooms ------------------------------------------------------

interface RoomsLayerProps {
  instances: readonly RoomInstance[];
  rooms: ReadonlyMap<string, RoomDocument>;
  selection: MapSelection;
  onSelect: (sel: MapSelection) => void;
  onMove: (id: string, position: [number, number, number]) => void;
  spawnToolActive: boolean;
  /** Spawn-tool drop callback. Clicking a cube fires this with the
   *  raycast hit point snapped to the nearest cube-grid Y level, so
   *  spawn markers land on cube tops rather than embedded in their
   *  sides. */
  onPlaceSpawn: (position: [number, number, number]) => void;
}

function RoomsLayer(props: RoomsLayerProps) {
  return (
    <>
      {props.instances.map((ri) => {
        const room = props.rooms.get(ri.roomName);
        const isSelected =
          props.selection !== null &&
          props.selection.kind === 'room' &&
          props.selection.id === ri.id;
        return (
          <RoomInstanceMesh
            key={ri.id}
            instance={ri}
            room={room}
            selected={isSelected}
            onSelect={() => props.onSelect({ kind: 'room', id: ri.id })}
            onMove={(pos) => props.onMove(ri.id, pos)}
            spawnToolActive={props.spawnToolActive}
            onPlaceSpawn={props.onPlaceSpawn}
          />
        );
      })}
    </>
  );
}

interface RoomInstanceMeshProps {
  instance: RoomInstance;
  room: RoomDocument | undefined;
  selected: boolean;
  onSelect: () => void;
  onMove: (position: [number, number, number]) => void;
  spawnToolActive: boolean;
  onPlaceSpawn: (position: [number, number, number]) => void;
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
  spawnToolActive,
  onPlaceSpawn,
}: RoomInstanceMeshProps) {
  // Wait for the catalog bootstrap before compiling. Without this gate,
  // getKindStride falls back to [1,1,1] for every kind on the first
  // paint — and any extrude or per-kind-stride placement compiles into
  // overlapping cubes (most visibly on the platform / long_corridor).
  const catalogReady = useCatalogReady();
  const compiled = useMemo(() => {
    if (!room || !catalogReady) return null;
    return compileScene(room, VOXEL_SIZE, (id) => getKindStride(id, VOXEL_SIZE));
  }, [room, catalogReady]);

  const worldObjects: WorldObjects | null = useMemo(() => {
    if (!compiled) return null;
    return {
      cubeSize: VOXEL_SIZE,
      instances: compiled.instances,
    };
  }, [compiled]);

  // Drag state: a left-pointer-down on the group enters drag mode;
  // pointer-move raycasts the floor to update the room position.
  const { camera, gl, raycaster, pointer } = useThree();
  const dragging = useRef(false);
  const dragStartOffset = useRef<[number, number, number]>([0, 0, 0]);

  useEffect(() => {
    const handlePointerMove = () => {
      if (!dragging.current) return;
      raycaster.setFromCamera(pointer, camera);
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const point = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(plane, point)) return;
      // Snap the room's anchor to the cube-size grid so cubes stay on
      // integer voxel coords after the offset is applied.
      const vx = Math.round((point.x - dragStartOffset.current[0]) / VOXEL_SIZE);
      const vz = Math.round((point.z - dragStartOffset.current[2]) / VOXEL_SIZE);
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
  const bounds = useMemo(() => {
    if (!compiled || compiled.instances.length === 0) return null;
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const inst of compiled.instances) {
      for (let a = 0; a < 3; a++) {
        if (inst.position[a] < min[a]) min[a] = inst.position[a];
        if (inst.position[a] > max[a]) max[a] = inst.position[a];
      }
    }
    return {
      min: [
        min[0] * VOXEL_SIZE - VOXEL_SIZE / 2,
        min[1] * VOXEL_SIZE,
        min[2] * VOXEL_SIZE - VOXEL_SIZE / 2,
      ] as [number, number, number],
      max: [
        max[0] * VOXEL_SIZE + VOXEL_SIZE / 2,
        max[1] * VOXEL_SIZE + VOXEL_SIZE,
        max[2] * VOXEL_SIZE + VOXEL_SIZE / 2,
      ] as [number, number, number],
    };
  }, [compiled]);

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
            if (spawnToolActive) {
              onPlaceSpawn(snapToCubeTop(e.point));
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
  return (
    <group
      position={groupPos}
      rotation={[0, rotationY, 0]}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        // Only react to cube hits; clicks on the floor / empty
        // space don't reach here.
        const hit = e.object as THREE.Object3D & {
          userData?: { isObjectInstanceMesh?: boolean };
        };
        if (!hit.userData?.isObjectInstanceMesh) return;
        e.stopPropagation();
        if (spawnToolActive) {
          // Spawn-tool path: drop a spawn at the raycast hit
          // point, snapped to the nearest cube-grid Y level so
          // markers land on cube tops (not embedded in sides).
          onPlaceSpawn(snapToCubeTop(e.point));
          return;
        }
        onSelect();
        // Capture the raycast hit's offset from the room anchor so
        // the room doesn't snap its centre to the cursor on drag.
        dragStartOffset.current = [
          e.point.x - groupPos[0],
          0,
          e.point.z - groupPos[2],
        ];
        dragging.current = true;
      }}
    >
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

function SpawnLayer({ spawns, selection, onSelect }: SpawnLayerProps) {
  return (
    <>
      {spawns.map((s) => {
        const isSelected =
          selection !== null && selection.kind === 'spawn' && selection.id === s.id;
        return (
          <group key={s.id} position={s.position}>
            <mesh
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                onSelect({ kind: 'spawn', id: s.id });
              }}
            >
              <coneGeometry args={[0.6, 1.6, 8]} />
              <meshStandardMaterial
                color={isSelected ? '#fde047' : '#22d3ee'}
                emissive={isSelected ? '#fde047' : '#0e7490'}
                emissiveIntensity={0.6}
              />
            </mesh>
            <mesh position={[0, 1.3, 0]}>
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
