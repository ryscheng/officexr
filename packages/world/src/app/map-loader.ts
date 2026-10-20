import type { WorldObjects } from '@officexr/sdk';
import type {
  LayoutDocument,
  LayoutStorage,
  MapDocumentV1,
  MapStorage,
  RoomDocument,
  RoomStorage,
  SpawnPoint,
} from '../scenes/index.ts';
import type { CatalogService, RoomService } from './types.ts';

export class MapNotFoundError extends Error {
  constructor(readonly mapName: string) {
    super(`map "${mapName}" not found`);
    this.name = 'MapNotFoundError';
  }
}

export interface MapLoaderDeps {
  storages: { maps: MapStorage; rooms: RoomStorage; layouts: LayoutStorage };
  catalog: Pick<CatalogService, 'ready'>;
  roomService: Pick<RoomService, 'compileMap'>;
}

export interface LoadedMap {
  mapDoc: MapDocumentV1;
  rooms: ReadonlyMap<string, RoomDocument>;
  worldObjects: WorldObjects;
  spawnPoints: readonly SpawnPoint[];
  /** Set only when exactly one distinct layout is referenced by the map's rooms. */
  bakedLayoutName?: string;
}

async function loadAll<T>(
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
        console.warn(`[map-loader] ${kind} load("${name}") failed:`, err);
        return null;
      }
    }),
  );
  return new Map(entries.filter((e) => e !== null));
}

/**
 * Loads a map, its rooms, and the layouts of rooms without commands, then
 * compiles it. Throws `MapNotFoundError` when the map doesn't exist.
 */
export async function loadMap(
  { storages, catalog, roomService }: MapLoaderDeps,
  name: string,
): Promise<LoadedMap> {
  // Kind strides are only correct once the catalog has landed.
  await catalog.ready();
  const mapDoc = await storages.maps.load(name);
  if (!mapDoc) {
    throw new MapNotFoundError(name);
  }
  const rooms = await loadAll(
    new Set(mapDoc.rooms.map((ri) => ri.roomName)),
    (n) => storages.rooms.load(n),
    'room',
  );
  const layoutNames = new Set<string>();
  for (const room of rooms.values()) {
    if (room.commands.length === 0 && room.layoutName !== undefined) {
      layoutNames.add(room.layoutName);
    }
  }
  const layouts = await loadAll<LayoutDocument>(
    layoutNames,
    (n) => storages.layouts.load(n),
    'layout',
  );

  const bakedLayoutNames = new Set<string>();
  for (const ri of mapDoc.rooms) {
    const layoutName = rooms.get(ri.roomName)?.layoutName;
    if (layoutName) {
      bakedLayoutNames.add(layoutName);
    }
  }
  if (bakedLayoutNames.size > 1) {
    console.warn(
      `[map-loader] map "${mapDoc.name}" references multiple layouts; baked-layout rendering supports one`,
      [...bakedLayoutNames],
    );
  }

  return {
    mapDoc,
    rooms,
    worldObjects: roomService.compileMap(mapDoc, rooms, layouts),
    spawnPoints: mapDoc.spawnPoints,
    bakedLayoutName:
      bakedLayoutNames.size === 1 ? [...bakedLayoutNames][0] : undefined,
  };
}
