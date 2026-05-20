import { LocalStorageRoomStorage } from './localstorage-room-storage.ts';
import { createMemoryWebStorage } from './in-memory-web-storage.ts';
import type { RoomDocument } from './commands.ts';
import type { RoomStorage, RoomSummary } from './filesystem-room-storage.ts';

export interface RoomSeedEntry {
  name: string;
  doc: RoomDocument;
}

/**
 * Hermetic, in-process `RoomStorage` for tests. Composes
 * `LocalStorageRoomStorage` over a `Map`-backed `Storage` shim so its
 * semantics — name validation, `migrateToV5(deserializeScene(...))` on
 * load, index bookkeeping — match the real localStorage path by
 * construction (LSP). Adds a `seed` convenience for pre-population.
 */
export class InMemoryRoomStorage implements RoomStorage {
  private delegate: LocalStorageRoomStorage;

  constructor(opts: { seed?: readonly RoomSeedEntry[] } = {}) {
    this.delegate = new LocalStorageRoomStorage({
      storage: createMemoryWebStorage(),
    });
    for (const entry of opts.seed ?? []) {
      void this.delegate.save(entry.name, entry.doc).catch(() => {});
    }
  }

  list(): Promise<RoomSummary[]> {
    return this.delegate.list();
  }

  load(name: string): Promise<RoomDocument | null> {
    return this.delegate.load(name);
  }

  save(name: string, room: RoomDocument): Promise<void> {
    return this.delegate.save(name, room);
  }

  delete(name: string): Promise<void> {
    return this.delegate.delete(name);
  }
}
