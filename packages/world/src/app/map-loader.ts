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
  /** Set only when exactly one distinct layout is referenced by the map's command-less (baked) rooms. */
  bakedLayoutName?: string;
  /** Where `bakedLayoutName` renders: its baked room's placement, in voxels. */
  bakedPlacement?: Pick<RoomInstance, 'position' | 'rotationY'>;
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
  const bakedRoomLayoutNames = new Set<string>();
  const linkedLayoutNames = new Set<string>();
  for (const room of rooms.values()) {
    if (room.layoutName !== undefined) {
      linkedLayoutNames.add(room.layoutName);
    }
    if (isBakedRoom(room)) {
      bakedRoomLayoutNames.add(room.layoutName);
    }
  }
  const layouts = await loadAll<LayoutDocument>(
    linkedLayoutNames,
    (n) => storages.layouts.load(n),
    'layout',
  );

  const bakedLayoutName = bakedRoomLayoutNames.size === 1 ? [...bakedRoomLayoutNames][0] : undefined;
  const bakedPlacements = bakedLayoutName ? mapDoc.rooms.filter((ri) => isBaked(ri.roomName)) : [];
  // ponytail(OSO-7186): <Scene> renders one baked layout at one placement; more need a bakedLayouts array prop.
  if (bakedRoomLayoutNames.size > 1) {
    console.warn(
      `[map-loader] map "${mapDoc.name}" references multiple layouts; baked-layout rendering supports one`,
      [...bakedRoomLayoutNames],
    );
  }
  if (bakedPlacements.length > 1) {
    console.warn(
      `[map-loader] map "${mapDoc.name}" places its baked layout ${bakedPlacements.length} times; rendering the first`,
    );
  }

  const bakedLayouts = mapDoc.rooms.flatMap((ri): BakedLayoutPlacement[] => {
    const layoutName = rooms.get(ri.roomName)?.layoutName;
    return layoutName === undefined
      ? []
      : [{ roomInstanceId: ri.id, layoutName, position: ri.position, rotationY: ri.rotationY ?? 0 }];
  });

  const worldObjects = roomService.compileMap(mapDoc, rooms, layouts);
  // Hands the zone helper the compile above rather than compiling the map twice.
  const voiceZones = computeVoiceZones(mapDoc, rooms, layouts, { compileMap: () => worldObjects }, geometry);

  return {
    mapDoc,
    rooms,
    worldObjects,
    voiceZones,
    spawnPoints: mapDoc.spawnPoints,
    bakedLayoutName,
    bakedPlacement: bakedPlacements[0],
    bakedLayouts,
  };
}
