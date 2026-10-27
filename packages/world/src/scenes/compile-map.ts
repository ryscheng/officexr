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

    const own = compileScene(room, voxelSize, kindStride).instances;
    instances.push(...applyRoomInstance(own, ri, `${ri.id}/`, voxelSize, worldAABB));
    if (getLayout !== undefined && room.layoutName !== undefined) {
      const layout = getLayout(room.layoutName);
      if (layout !== undefined) {
        // Separate id namespace: the room's command ids are minted per document and could collide.
        const fromLayout = compileScene(layout, voxelSize, kindStride).instances;
        instances.push(...applyRoomInstance(fromLayout, ri, `${ri.id}/layout/`, voxelSize, worldAABB));
      } else {
        console.warn(
          `[compile-map] room "${ri.roomName}" has layoutName "${room.layoutName}" but getLayout returned undefined`,
        );
      }
    }
  }

  // Keep iteration order deterministic so the diff broadcaster sees a
  // stable JSON shape across runs (matches `compileScene`).
  instances.sort((a, b) => a.id.localeCompare(b.id));
  // cubeSize key is required by the SDK WorldObjects type — kept as-is.
  return { cubeSize: voxelSize, instances };
}

/** Same sense as three.js `rotation.y = rot·π/2` (the map editor's room group). */
function rotateXZ(rot: 0 | 1 | 2 | 3, x: number, z: number): [number, number] {
  return rot === 0 ? [x, z] : rot === 1 ? [z, -x] : rot === 2 ? [-x, -z] : [-z, x];
}

function applyRoomInstance(
  src: ObjectInstance[],
  ri: RoomInstance,
  idPrefix: string,
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
      id: `${idPrefix}${inst.id}`,
      sourceCommandId: `${idPrefix}${inst.sourceCommandId}`,
      kindId: inst.kindId,
      position: [rx + (hx - halfW) + ox, y + oy, rz + (hz - halfD) + oz],
      ...(yawDeg !== 0 && { yawDeg }),
    };
  });
}
