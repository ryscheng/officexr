import type { ObjectInstance, WorldObjects } from '@officexr/sdk';
import type { MapDocumentV1, RoomInstance } from './map-document.ts';
import type { RoomDocument, SceneCommand } from './commands.ts';
import { compileScene, type KindStrideLookup } from './compile.ts';

/**
 * Optional layout resolver for baked-only rooms. When provided, a room
 * with empty `commands` and a `layoutName` will be compiled from the
 * layout's commands instead of the (empty) room commands. This gives
 * `BotPhysicsWorld.syncCubes` precise per-cube colliders derived from
 * the same authored geometry as the baked GLB, so bots have a real
 * floor on baked-layout maps without any store-injection hack.
 *
 * The resolver is intentionally optional (not part of the default
 * signature) so that all existing callers (room editor, map editor, and
 * any test that does not supply layouts) remain byte-for-byte unchanged.
 * Only the debug runtime (`useMapPicker`) opts in by passing this
 * function. Editor paths explicitly do NOT pass it — they only see the
 * room's own commands, which is the correct authoring-time behavior.
 */
export type LayoutResolver = (layoutName: string) => { commands: SceneCommand[] } | undefined;

/**
 * Pure replay of a `MapDocumentV1` against the rooms it references.
 * For each `RoomInstance`:
 *   1. Compile the referenced `RoomDocument` to its local
 *      `ObjectInstance[]` via `compileScene` (cube positions in voxel
 *      coords relative to the room's origin).
 *      - If the room has no inline commands but names a layout AND
 *        `getLayout` is provided, compile the layout's commands instead.
 *   2. Apply the quarter-turn yaw rotation around the room-local
 *      origin (`rotationY`: 0=identity, 1=+90° about Y, 2=180°, 3=270°).
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
  map: MapDocumentV1,
  rooms: ReadonlyMap<string, RoomDocument>,
  voxelSize: number,
  kindStride?: KindStrideLookup,
  getLayout?: LayoutResolver,
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

    // Baked-layout resolution: when the room has no inline commands but
    // references a layout, compile from the layout's commands so
    // BotPhysicsWorld.syncCubes gets real per-cube colliders. This only
    // fires when getLayout is supplied (opt-in, debug runtime only).
    //
    // OCP note: we treat this as an extension point — no existing branch
    // in this function changes; the new behavior is additive, gated by the
    // optional resolver. Callers that don't supply getLayout are unaffected.
    let compileInput: { commands: SceneCommand[] } = room;
    if (
      getLayout !== undefined &&
      room.commands.length === 0 &&
      room.layoutName !== undefined
    ) {
      const layout = getLayout(room.layoutName);
      if (layout !== undefined) {
        compileInput = layout;
      } else {
        console.warn(
          `[compile-map] room "${ri.roomName}" has layoutName "${room.layoutName}" but getLayout returned undefined`,
        );
      }
    }

    const compiled = compileScene(compileInput, voxelSize, kindStride);
    const rotated = applyRoomInstance(compiled.instances, ri);
    instances.push(...rotated);
  }

  // Keep iteration order deterministic so the diff broadcaster sees a
  // stable JSON shape across runs (matches `compileScene`).
  instances.sort((a, b) => a.id.localeCompare(b.id));
  // cubeSize key is required by the SDK WorldObjects type — kept as-is.
  return { cubeSize: voxelSize, instances };
}

function applyRoomInstance(
  src: ObjectInstance[],
  ri: RoomInstance,
): ObjectInstance[] {
  const rot = ri.rotationY ?? 0;
  const [ox, oy, oz] = ri.position;
  const out: ObjectInstance[] = new Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const inst = src[i];
    const [x, y, z] = inst.position;
    let rx = x;
    let rz = z;
    switch (rot) {
      case 0:
        rx = x;
        rz = z;
        break;
      case 1:
        // +90° about +Y (right-handed, Y up): (x,z) → (z, -x)
        rx = z;
        rz = -x;
        break;
      case 2:
        rx = -x;
        rz = -z;
        break;
      case 3:
        rx = -z;
        rz = x;
        break;
    }
    out[i] = {
      id: `${ri.id}/${inst.id}`,
      sourceCommandId: `${ri.id}/${inst.sourceCommandId}`,
      kindId: inst.kindId,
      position: [rx + ox, y + oy, rz + oz],
    };
  }
  return out;
}
