import type { WorldObjects } from '@officexr/sdk';
import {
  isBakedRoom,
  migrateMapV1toV2,
  type LayoutDocument,
  type LayoutStorage,
  type MapDocumentV2,
  type MapStorage,
  type RoomDocument,
  type RoomInstance,
  type RoomStorage,
  type SpawnPoint,
} from '../scenes/index.ts';
import type { CatalogService, RoomService } from './types.ts';

export class MapNotFoundError extends Error {
  constructor(readonly mapName: string) {
    super(`map "${mapName}" not found`);
    this.name = 'MapNotFoundError';
  }
}

export interface MapLoaderDeps {
  storages: { maps: Pick<MapStorage, 'load'>; rooms: RoomStorage; layouts: LayoutStorage };
  catalog: Pick<CatalogService, 'ready'>;
  roomService: Pick<RoomService, 'compileMap'>;
}

export interface LoadedMap {
  mapDoc: MapDocumentV2;
  rooms: ReadonlyMap<string, RoomDocument>;
  worldObjects: WorldObjects;
  spawnPoints: readonly SpawnPoint[];
  /** Set only when exactly one distinct layout is referenced by the map's rooms. */
  bakedLayoutName?: string;
  /** Where `bakedLayoutName` renders: its baked room's placement, in voxels. */
  bakedPlacement?: Pick<RoomInstance, 'position' | 'rotationY'>;
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
  const stored = await storages.maps.load(name);
  if (!stored) {
    throw new MapNotFoundError(name);
  }
  const rooms = await loadAll(
    new Set(stored.rooms.map((ri) => ri.roomName)),
    (n) => storages.rooms.load(n),
    'room',
  );
  const isBaked = (roomName: string) => {
    const room = rooms.get(roomName);
    return room !== undefined && isBakedRoom(room);
  };
  const mapDoc = stored.schemaVersion === 1 ? migrateMapV1toV2(stored, isBaked) : stored;
  const layoutNames = new Set<string>();
  for (const room of rooms.values()) {
    if (isBakedRoom(room)) {
      layoutNames.add(room.layoutName);
    }
  }
  const layouts = await loadAll<LayoutDocument>(
    layoutNames,
    (n) => storages.layouts.load(n),
    'layout',
  );

  const bakedLayoutName = layoutNames.size === 1 ? [...layoutNames][0] : undefined;
  const bakedPlacements = bakedLayoutName ? mapDoc.rooms.filter((ri) => isBaked(ri.roomName)) : [];
  // ponytail: <Scene> renders one baked layout at one placement; more need a bakedLayouts array prop.
  if (layoutNames.size > 1) {
    console.warn(
      `[map-loader] map "${mapDoc.name}" references multiple layouts; baked-layout rendering supports one`,
      [...layoutNames],
    );
  }
  if (bakedPlacements.length > 1) {
    console.warn(
      `[map-loader] map "${mapDoc.name}" places its baked layout ${bakedPlacements.length} times; rendering the first`,
    );
  }

  return {
    mapDoc,
    rooms,
    worldObjects: roomService.compileMap(mapDoc, rooms, layouts),
    spawnPoints: mapDoc.spawnPoints,
    bakedLayoutName,
    bakedPlacement: bakedPlacements[0],
  };
}
