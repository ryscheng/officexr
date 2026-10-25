import type {
  BakedLayoutStorage,
  CatalogStorage,
  LayoutStorage,
  MapStorage,
  RoomStorage,
  WorldConstantsStorage,
} from '@officexr/world/scenes';

/** Everything the tools read and write The `Filesystem*` clients satisfy it; in-memory storages cover everything but `bakedLayouts`. */
export interface StudioDocuments {
  rooms: RoomStorage;
  maps: MapStorage;
  layouts: LayoutStorage;
  catalog: CatalogStorage;
  worldSettings: WorldConstantsStorage;
  bakedLayouts: BakedLayoutStorage;
}
