import type { ObjectInstance, WorldObjects } from '@officexr/sdk';
import type { MapDocumentV2, RoomInstance } from './map-document.ts';
import {
  normalizeYawDeg,
  type RoomDocument,
  type SceneCommand,
} from './commands.ts';
import { compileScene, type KindStrideLookup } from './compile.ts';

/**
 * Optional layout resolver. When provided, a room that links a layout also
 * compiles the layout's commands, alongside the room's own, so
 * `BotPhysicsWorld.syncCubes` gets per-cube colliders derived from the same
 * authored geometry as the baked GLB.
 *
 * Only the runtime map loader (`loadMap`) passes it. Editors that draw the
 * baked GLB themselves compile just the room's own commands.
 */
export type LayoutResolver = (layoutName: string) => { commands: SceneCommand[] } | undefined;

type Vec3 = readonly [number, number, number];

/** Unrotated world AABB (m) of an object at `position` (mirrors
 * `InstanceGeometryService.worldAABB`). */
type WorldAABBLookup = (position: Vec3, kindId: string) => { min: Vec3; max: Vec3 };

/**
 * Pure replay of a `MapDocumentV2` against the rooms it references.
 * For each `RoomInstance`:
 *   1. Compile the referenced `RoomDocument` to its local
 *      `ObjectInstance[]` via `compileScene` (cube positions in voxel
 *      coords relative to the room's origin).
 *      - If the room names a layout AND `getLayout` is provided, also compile
 *        the layout's commands; their ids live under `<RoomInstance.id>/layout/`.
 *   2. Rotate each object's footprint centre by a quarter-turn yaw around the
 *      room-local origin (`rotationY`: 0=identity, 1=+90° about Y, 2=180°, 3=270°)
 *      and add the same turn to the object's yaw.
 *   3. Translate by the instance position (voxel coords).
 *   4. Namespace each instance's id and sourceCommandId with the
 *      `RoomInstance.id` so two placements of the same room don't
 *      collide on the resulting `ObjectInstance.id`.
 *
 * Missing room references are skipped with a console warning. This
 * matches the room editor's "missing kind" behavior — we'd rather
 * draw what we can than throw.
 *
 * Returns a flat `WorldObjects` so the SDK store can broadcast the
 * compiled map identically to a single-room scene.
 */
export function compileMap(
  map: MapDocumentV2,
  rooms: ReadonlyMap<string, RoomDocument>,
  voxelSize: number,
  kindStride?: KindStrideLookup,
  getLayout?: LayoutResolver,
  worldAABB?: WorldAABBLookup,
): WorldObjects {
  const instances: ObjectInstance[] = [];

  for (const ri of map.rooms) {
    const room = rooms.get(ri.roomName);
    if (!room) {
      console.warn(
        `[compile-map] missing room "${ri.roomName}" referenced by instance "${ri.id}"`,
      );
      continue;
    }

    const compiled = compileScene(room, voxelSize, kindStride).instances;
    if (getLayout !== undefined && room.layoutName !== undefined) {
      const layout = getLayout(room.layoutName);
      if (layout !== undefined) {
        const layoutInstances = compileScene(layout, voxelSize, kindStride).instances;
        compiled.push(...namespaceLayoutInstances(layoutInstances));
      } else {
        console.warn(
          `[compile-map] room "${ri.roomName}" has layoutName "${room.layoutName}" but getLayout returned undefined`,
        );
      }
    }
    const rotated = applyRoomInstance(compiled, ri, voxelSize, worldAABB);
    instances.push(...rotated);
  }

  // Keep iteration order deterministic so the diff broadcaster sees a
  // stable JSON shape across runs (matches `compileScene`).
  instances.sort((a, b) => a.id.localeCompare(b.id));
  // cubeSize key is required by the SDK WorldObjects type — kept as-is.
  return { cubeSize: voxelSize, instances };
}

/** Keeps layout ids apart from the room's own command ids, which are minted per document. */
function namespaceLayoutInstances(src: ObjectInstance[]): ObjectInstance[] {
  return src.map((inst) => ({
    ...inst,
    id: `layout/${inst.id}`,
    sourceCommandId: `layout/${inst.sourceCommandId}`,
  }));
}

/** Same sense as three.js `rotation.y = rot·π/2` (the map editor's room group). */
function rotateXZ(rot: 0 | 1 | 2 | 3, x: number, z: number): [number, number] {
  return rot === 0 ? [x, z] : rot === 1 ? [z, -x] : rot === 2 ? [-x, -z] : [-z, x];
}

function applyRoomInstance(
  src: ObjectInstance[],
  ri: RoomInstance,
  voxelSize: number,
  worldAABB?: WorldAABBLookup,
): ObjectInstance[] {
  const rot = ri.rotationY ?? 0;
  const [ox, oy, oz] = ri.position;
  return src.map((inst) => {
    const [x, y, z] = inst.position;
    const aabb = worldAABB?.(inst.position, inst.kindId);
    const halfW = aabb ? (aabb.max[0] - aabb.min[0]) / voxelSize / 2 : 0.5;
    const halfD = aabb ? (aabb.max[2] - aabb.min[2]) / voxelSize / 2 : 0.5;
    // The object yaws about its unrotated footprint's centre, so turning
    // the room moves only that centre; `position` stays the unrotated
    // min corner around it. Rotating the corner and the half-size
    // separately keeps rotationY 0 free of float noise.
    const [rx, rz] = rotateXZ(rot, x, z);
    const [hx, hz] = rotateXZ(rot, halfW, halfD);
    const yawDeg = normalizeYawDeg((inst.yawDeg ?? 0) + 90 * rot);
    return {
      id: `${ri.id}/${inst.id}`,
      sourceCommandId: `${ri.id}/${inst.sourceCommandId}`,
      kindId: inst.kindId,
      position: [rx + (hx - halfW) + ox, y + oy, rz + (hz - halfD) + oz],
      ...(yawDeg !== 0 && { yawDeg }),
    };
  });
}
