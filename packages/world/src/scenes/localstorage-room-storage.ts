import {
  deserializeScene,
  migrateToV3,
} from './serialize.ts';
import { isValidSceneName } from './storage.ts';
import type { RoomDocument } from './commands.ts';
import type {
  RoomStorage,
  RoomSummary,
} from './filesystem-room-storage.ts';

/**
 * Browser localStorage-backed room store. Mirrors
 * `LocalStorageSceneStorage` but always migrates the loaded payload
 * through `migrateToV3`, so callers get a v3 `RoomDocument` back.
 *
 * Used:
 *   - As the offline / static-build fallback when no Vite middleware
 *     is mounted.
 *   - As a write-through cache layered on top of
 *     `FilesystemRoomStorage`.
 *   - In tests / CI where filesystem I/O isn't available.
 */
const KEY_PREFIX = 'officexr:room:';
const INDEX_KEY = `${KEY_PREFIX}__index__`;

interface IndexEntry {
  title?: string;
  updatedAt: number;
}
type IndexShape = Record<string, IndexEntry>;

export class LocalStorageRoomStorage implements RoomStorage {
  private storage: Storage;

  constructor(opts: { storage?: Storage } = {}) {
    if (opts.storage) {
      this.storage = opts.storage;
    } else if (
      typeof globalThis !== 'undefined' &&
      typeof globalThis.localStorage !== 'undefined'
    ) {
      this.storage = globalThis.localStorage;
    } else {
      throw new Error('LocalStorageRoomStorage: no Storage available');
    }
  }

  private readIndex(): IndexShape {
    const raw = this.storage.getItem(INDEX_KEY);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as IndexShape;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private writeIndex(idx: IndexShape): void {
    this.storage.setItem(INDEX_KEY, JSON.stringify(idx));
  }

  async list(): Promise<RoomSummary[]> {
    const idx = this.readIndex();
    return Object.entries(idx).map(([name, entry]) => ({
      name,
      title: entry.title,
      updatedAt: entry.updatedAt,
    }));
  }

  async load(name: string): Promise<RoomDocument | null> {
    if (!isValidSceneName(name)) {
      throw new Error(`room-storage load: invalid name "${name}"`);
    }
    const raw = this.storage.getItem(KEY_PREFIX + name);
    if (!raw) return null;
    try {
      return migrateToV3(deserializeScene(JSON.parse(raw) as unknown));
    } catch (err) {
      throw new Error(`room-storage load(${name}): ${(err as Error).message}`);
    }
  }

  async save(name: string, room: RoomDocument): Promise<void> {
    if (!isValidSceneName(name)) {
      throw new Error(`room-storage save: invalid name "${name}"`);
    }
    this.storage.setItem(KEY_PREFIX + name, JSON.stringify(room));
    const idx = this.readIndex();
    idx[name] = { title: room.title, updatedAt: room.updatedAt ?? Date.now() };
    this.writeIndex(idx);
  }

  async delete(name: string): Promise<void> {
    if (!isValidSceneName(name)) {
      throw new Error(`room-storage delete: invalid name "${name}"`);
    }
    this.storage.removeItem(KEY_PREFIX + name);
    const idx = this.readIndex();
    if (name in idx) {
      delete idx[name];
      this.writeIndex(idx);
    }
  }
}
