import { isBakedRoom, type RoomDocument } from './commands.ts';
import type { MapDocumentV2, RoomInstance, SerializedMap } from './map-document.ts';
import { migrateMapV1toV2 } from './serialize.ts';

/** One room placement that links a baked layout; `position` is in voxels. */
export interface BakedLayoutPlacement {
  roomInstanceId: string;
  layoutName: string;
  position: RoomInstance['position'];
  rotationY: NonNullable<RoomInstance['rotationY']>;
}

/** Loads each name once, concurrently; a name that is absent or fails to load is left out (failures are warned). */
export async function loadAll<T>(
  names: Iterable<string>,
  load: (name: string) => Promise<T | null>,
  kind: string,
): Promise<Map<string, T>> {
  const entries = await Promise.all(
    Array.from(names).map(async (name) => {
      try {
        const doc = await load(name);
        return doc ? ([name, doc] as const) : null;
      } catch (err) {
        console.warn(`[scenes] ${kind} load("${name}") failed:`, err);
        return null;
      }
    }),
  );
  return new Map(entries.filter((e) => e !== null));
}

export interface MapLayoutPlacements {
  /** The map as schema v2 (a v1 map is migrated using the loaded rooms). */
  mapDoc: MapDocumentV2;
  rooms: ReadonlyMap<string, RoomDocument>;
  /** One per room placement whose room links a layout; several may share a `layoutName`. */
  placements: BakedLayoutPlacement[];
  /** Referenced room names that were not found or failed to load. */
  missingRooms: string[];
}

/** Loads the rooms a map places and derives which baked layout each placement uses. */
export async function mapLayoutPlacements(
  map: SerializedMap,
  loadRoom: (name: string) => Promise<RoomDocument | null>,
): Promise<MapLayoutPlacements> {
  const roomNames = new Set(map.rooms.map((ri) => ri.roomName));
  const rooms = await loadAll(roomNames, loadRoom, 'room');
  const mapDoc =
    map.schemaVersion === 1
      ? migrateMapV1toV2(map, (name) => {
          const room = rooms.get(name);
          return room !== undefined && isBakedRoom(room);
        })
      : map;
  const placements = mapDoc.rooms.flatMap((ri): BakedLayoutPlacement[] => {
    const layoutName = rooms.get(ri.roomName)?.layoutName;
    return layoutName === undefined
      ? []
      : [{ roomInstanceId: ri.id, layoutName, position: ri.position, rotationY: ri.rotationY ?? 0 }];
  });
  const missingRooms = [...roomNames].filter((name) => !rooms.has(name));
  return { mapDoc, rooms, placements, missingRooms };
}

/** Room instance ids per distinct layout, in first-placement order. */
export function groupPlacementsByLayout(placements: readonly BakedLayoutPlacement[]): Map<string, string[]> {
  const byLayout = new Map<string, string[]>();
  for (const { layoutName, roomInstanceId } of placements) {
    const ids = byLayout.get(layoutName);
    if (ids) {
      ids.push(roomInstanceId);
    } else {
      byLayout.set(layoutName, [roomInstanceId]);
    }
  }
  return byLayout;
}
