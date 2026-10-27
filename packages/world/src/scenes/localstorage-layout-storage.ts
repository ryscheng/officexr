import { deserializeLayout } from './layout-document.ts';
import { isValidSceneName } from './storage.ts';
import type { LayoutDocument } from './layout-document.ts';
import type {
  LayoutStorage,
  LayoutSummary,
} from './filesystem-layout-storage.ts';

/**
 * Browser localStorage-backed layout store. Mirrors
 * `LocalStorageRoomStorage` but typed for `LayoutDocument`.
 *
 * Note: baked GLBs are NOT stored in localStorage — they would be
 * prohibitively large. This implementation handles layout JSON only.
 * The binary `/api/baked-layouts` endpoints are filesystem-only.
 *
 * Used as an offline / static-build fallback and in tests.
 */
const KEY_PREFIX = 'officexr:layout:';
const INDEX_KEY = `${KEY_PREFIX}__index__`;

interface IndexEntry {
  title?: string;
  updatedAt: number;
}
type IndexShape = Record<string, IndexEntry>;

export class LocalStorageLayoutStorage implements LayoutStorage {
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
      throw new Error('LocalStorageLayoutStorage: no Storage available');
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

  async list(): Promise<LayoutSummary[]> {
    const idx = this.readIndex();
    return Object.entries(idx).map(([name, entry]) => ({
      name,
      title: entry.title,
      updatedAt: entry.updatedAt,
    }));
  }

  async load(name: string): Promise<LayoutDocument | null> {
    if (!isValidSceneName(name)) {
      throw new Error(`layout-storage load: invalid name "${name}"`);
    }
    const raw = this.storage.getItem(KEY_PREFIX + name);
    if (!raw) return null;
    try {
      return deserializeLayout(JSON.parse(raw) as unknown);
    } catch (err) {
      throw new Error(`layout-storage load(${name}): ${(err as Error).message}`);
    }
  }

  async save(name: string, layout: LayoutDocument): Promise<void> {
    if (!isValidSceneName(name)) {
      throw new Error(`layout-storage save: invalid name "${name}"`);
    }
    this.storage.setItem(KEY_PREFIX + name, JSON.stringify(layout));
    const idx = this.readIndex();
    idx[name] = { title: layout.title, updatedAt: layout.updatedAt ?? Date.now() };
    this.writeIndex(idx);
  }

  async delete(name: string): Promise<void> {
    if (!isValidSceneName(name)) {
      throw new Error(`layout-storage delete: invalid name "${name}"`);
    }
    this.storage.removeItem(KEY_PREFIX + name);
    const idx = this.readIndex();
    if (name in idx) {
      delete idx[name];
      this.writeIndex(idx);
    }
  }
}
