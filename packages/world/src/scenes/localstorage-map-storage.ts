import { deserializeMap } from './serialize.ts';
import { isValidSceneName } from './storage.ts';
import type { MapDocumentV1 } from './map-document.ts';
import type { MapStorage, MapSummary } from './filesystem-map-storage.ts';

const KEY_PREFIX = 'officexr:map:';
const INDEX_KEY = `${KEY_PREFIX}__index__`;

interface IndexEntry {
  title?: string;
  updatedAt: number;
}
type IndexShape = Record<string, IndexEntry>;

export class LocalStorageMapStorage implements MapStorage {
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
      throw new Error('LocalStorageMapStorage: no Storage available');
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

  async list(): Promise<MapSummary[]> {
    const idx = this.readIndex();
    return Object.entries(idx).map(([name, entry]) => ({
      name,
      title: entry.title,
      updatedAt: entry.updatedAt,
    }));
  }

  async load(name: string): Promise<MapDocumentV1 | null> {
    if (!isValidSceneName(name)) {
      throw new Error(`map-storage load: invalid name "${name}"`);
    }
    const raw = this.storage.getItem(KEY_PREFIX + name);
    if (!raw) return null;
    try {
      return deserializeMap(JSON.parse(raw) as unknown);
    } catch (err) {
      throw new Error(`map-storage load(${name}): ${(err as Error).message}`);
    }
  }

  async save(name: string, map: MapDocumentV1): Promise<void> {
    if (!isValidSceneName(name)) {
      throw new Error(`map-storage save: invalid name "${name}"`);
    }
    this.storage.setItem(KEY_PREFIX + name, JSON.stringify(map));
    const idx = this.readIndex();
    idx[name] = { title: map.title, updatedAt: map.updatedAt ?? Date.now() };
    this.writeIndex(idx);
  }

  async delete(name: string): Promise<void> {
    if (!isValidSceneName(name)) {
      throw new Error(`map-storage delete: invalid name "${name}"`);
    }
    this.storage.removeItem(KEY_PREFIX + name);
    const idx = this.readIndex();
    if (name in idx) {
      delete idx[name];
      this.writeIndex(idx);
    }
  }
}
