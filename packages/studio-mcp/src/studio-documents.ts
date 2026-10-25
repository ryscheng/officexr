import type {
  CatalogStorage,
  LayoutStorage,
  MapStorage,
  RoomStorage,
  WorldConstantsStorage,
} from '@officexr/world/scenes';

/** Everything the tools read and write; the `Filesystem*` clients and the in-memory storages satisfy it. */
export interface BakedLayoutSummary {
  name: string;
  size: number;
  updatedAt: number;
}

/** Baked GLBs; saves and deletes go through the REST surface so its publish hooks run. */
export interface BakedLayoutStorage {
  list(): Promise<BakedLayoutSummary[]>;
  save(name: string, glb: Uint8Array): Promise<void>;
  delete(name: string): Promise<void>;
}

export interface StudioDocuments {
  bakedLayouts: BakedLayoutStorage;
  rooms: RoomStorage;
  maps: MapStorage;
  layouts: LayoutStorage;
  catalog: CatalogStorage;
  worldSettings: WorldConstantsStorage;
}
