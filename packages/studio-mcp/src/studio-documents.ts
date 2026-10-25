import type {
  BakedLayoutSummary,
  CatalogStorage,
  LayoutStorage,
  MapStorage,
  RoomStorage,
  WorldConstantsStorage,
} from '@officexr/world/scenes';

export interface BakedLayoutStorage {
  list(): Promise<BakedLayoutSummary[]>;
  save(name: string, glb: Uint8Array): Promise<void>;
  delete(name: string): Promise<void>;
}

/** Everything the tools read and write; the `Filesystem*` clients and the in-memory storages satisfy it. */
export interface StudioDocuments {
  rooms: RoomStorage;
  maps: MapStorage;
  layouts: LayoutStorage;
  catalog: CatalogStorage;
  worldSettings: WorldConstantsStorage;
  bakedLayouts: BakedLayoutStorage;
}
