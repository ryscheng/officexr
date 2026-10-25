import type {
  CatalogStorage,
  LayoutStorage,
  MapStorage,
  RoomStorage,
  WorldConstantsStorage,
} from '@officexr/world/scenes';

/** Everything the tools read and write; the `Filesystem*` clients and the in-memory storages satisfy it. */
export interface StudioDocuments {
  rooms: RoomStorage;
  maps: MapStorage;
  layouts: LayoutStorage;
  catalog: CatalogStorage;
  worldSettings: WorldConstantsStorage;
}
