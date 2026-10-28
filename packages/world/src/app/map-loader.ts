import type { VoiceZone, WorldObjects } from '@officexr/sdk';
import {
  mapLayoutPlacements,
  type BakedLayoutPlacement,
  type LayoutDocument,
  type LayoutStorage,
  type MapDocumentV2,
  type MapStorage,
  type RoomDocument,
  type RoomStorage,
  type SpawnPoint,
} from '../scenes/index.ts';
import { loadAll } from '../scenes/map-layout-placements.ts';
import type { CatalogService, InstanceGeometryService, RoomService } from './types.ts';
import { computeVoiceZones } from './voice-zones.ts';

export type { BakedLayoutPlacement };

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

export interface LoadedMap {
  mapDoc: MapDocumentV2;
  rooms: ReadonlyMap<string, RoomDocument>;
  worldObjects: WorldObjects;
  voiceZones: VoiceZone[];
  spawnPoints: readonly SpawnPoint[];
  /** Every room placement that links a layout, whether or not the room has commands. */
  bakedLayouts: readonly BakedLayoutPlacement[];
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
  const { mapDoc, rooms, placements: bakedLayouts } = await mapLayoutPlacements(stored, (n) => storages.rooms.load(n));
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
