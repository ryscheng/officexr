import type { VoiceZone, WorldObjects } from '@officexr/sdk';
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
import type { CatalogService, InstanceGeometryService, RoomService } from './types.ts';
import { computeVoiceZones } from './voice-zones.ts';

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
  geometry: Pick<InstanceGeometryService, 'worldAABBOfInstance'>;
}

/** One room placement that links a baked layout; `position` is in voxels. */
export interface BakedLayoutPlacement {
  roomInstanceId: string;
  layoutName: string;
  position: RoomInstance['position'];
  rotationY: NonNullable<RoomInstance['rotationY']>;
}

export interface LoadedMap {
  mapDoc: MapDocumentV2;
  rooms: ReadonlyMap<string, RoomDocument>;
  worldObjects: WorldObjects;
  voiceZones: VoiceZone[];
  spawnPoints: readonly SpawnPoint[];
  /** Every room placement that links a layout, whether or not the room has commands. */
  bakedLayouts: readonly BakedLayoutPlacement[];
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
 * Loads a map, its rooms, and the layout of every room that links one, then
 * compiles it and derives its voice zones. Throws `MapNotFoundError` when the map doesn't exist.
 */
export async function loadMap(
  { storages, catalog, roomService, geometry }: MapLoaderDeps,
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
  const bakedLayouts = mapDoc.rooms.flatMap((ri): BakedLayoutPlacement[] => {
    const layoutName = rooms.get(ri.roomName)?.layoutName;
    return layoutName === undefined
      ? []
      : [{ roomInstanceId: ri.id, layoutName, position: ri.position, rotationY: ri.rotationY ?? 0 }];
  });
  const layouts = await loadAll<LayoutDocument>(
    new Set(bakedLayouts.map((p) => p.layoutName)),
    (n) => storages.layouts.load(n),
    'layout',
  );

  const worldObjects = roomService.compileMap(mapDoc, rooms, layouts);
  // Hands the zone helper the compile above rather than compiling the map twice.
  const voiceZones = computeVoiceZones(mapDoc, rooms, layouts, { compileMap: () => worldObjects }, geometry);

  return {
    mapDoc,
    rooms,
    worldObjects,
    voiceZones,
    spawnPoints: mapDoc.spawnPoints,
    bakedLayouts,
  };
}
