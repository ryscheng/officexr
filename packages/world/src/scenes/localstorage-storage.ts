import { deserializeScene, type SerializedScene } from './serialize.ts';
import {
  isValidSceneName,
  type SceneStorage,
  type SceneSummary,
} from './storage.ts';

/**
 * Browser localStorage-backed scene store. Used:
 *   - As the offline / static-build fallback when no Vite middleware
 *     is mounted.
 *   - As a write-through cache layered on top of
 *     `FilesystemSceneStorage` so a hot-reload doesn't lose unsaved
 *     work.
 *   - In tests / CI where filesystem I/O isn't available.
 *
 * Keys are namespaced under `officexr:scene:<name>`; the index lives
 * under `officexr:scene:__index__` and tracks all known names + their
 * updatedAt timestamps so `list()` is a single read.
 */
const KEY_PREFIX = 'officexr:scene:';
const INDEX_KEY = `${KEY_PREFIX}__index__`;

interface IndexEntry {
  title?: string;
  updatedAt: number;
}
type IndexShape = Record<string, IndexEntry>;

export class LocalStorageSceneStorage implements SceneStorage {
  private storage: Storage;

  constructor(opts: { storage?: Storage } = {}) {
    if (opts.storage) {
      this.storage = opts.storage;
    } else if (typeof globalThis !== 'undefined' && typeof globalThis.localStorage !== 'undefined') {
      this.storage = globalThis.localStorage;
    } else {
      throw new Error('LocalStorageSceneStorage: no Storage available');
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

  async list(): Promise<SceneSummary[]> {
    const idx = this.readIndex();
    return Object.entries(idx).map(([name, entry]) => ({
      name,
      title: entry.title,
      updatedAt: entry.updatedAt,
    }));
  }

  async load(name: string): Promise<SerializedScene | null> {
    if (!isValidSceneName(name)) {
      throw new Error(`scene-storage load: invalid name "${name}"`);
    }
    const raw = this.storage.getItem(KEY_PREFIX + name);
    if (!raw) return null;
    try {
      return deserializeScene(JSON.parse(raw) as unknown);
    } catch (err) {
      throw new Error(`scene-storage load(${name}): ${(err as Error).message}`);
    }
  }

  async save(name: string, scene: SerializedScene): Promise<void> {
    if (!isValidSceneName(name)) {
      throw new Error(`scene-storage save: invalid name "${name}"`);
    }
    this.storage.setItem(KEY_PREFIX + name, JSON.stringify(scene));
    const idx = this.readIndex();
    idx[name] = { title: scene.title, updatedAt: scene.updatedAt ?? Date.now() };
    this.writeIndex(idx);
  }

  async delete(name: string): Promise<void> {
    if (!isValidSceneName(name)) {
      throw new Error(`scene-storage delete: invalid name "${name}"`);
    }
    this.storage.removeItem(KEY_PREFIX + name);
    const idx = this.readIndex();
    if (name in idx) {
      delete idx[name];
      this.writeIndex(idx);
    }
  }
}
