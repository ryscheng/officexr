import { deserializeScene, type SerializedScene } from './serialize.ts';
import {
  isValidSceneName,
  type SceneStorage,
  type SceneSummary,
} from './storage.ts';

/**
 * Browser-side adapter that talks to the Vite middleware in
 * `vite-plugin-scene-storage.ts`. The middleware exposes:
 *
 *   GET    /api/scenes              → SceneSummary[]
 *   GET    /api/scenes/:name        → SerializedScene | 404
 *   PUT    /api/scenes/:name        → 204; body = SerializedScene
 *   DELETE /api/scenes/:name        → 204
 *
 * This is the default storage when running `pnpm --filter
 * @officexr/studio dev` — the middleware mounts under the same Vite
 * dev server the page is served from, so requests are same-origin and
 * no CORS dance is needed.
 *
 * For static builds (no dev server), use `LocalStorageSceneStorage`
 * instead — or compose both via a write-through cache pattern.
 */
export class FilesystemSceneStorage implements SceneStorage {
  private base: string;

  constructor(opts: { basePath?: string } = {}) {
    // Trim trailing slash so we can always concat with `/scenes`.
    this.base = (opts.basePath ?? '/api/scenes').replace(/\/$/, '');
  }

  async list(): Promise<SceneSummary[]> {
    const r = await fetch(this.base, { method: 'GET' });
    if (!r.ok) throw new Error(`scene-storage list: ${r.status}`);
    const json = (await r.json()) as { scenes?: SceneSummary[] };
    return Array.isArray(json.scenes) ? json.scenes : [];
  }

  async load(name: string): Promise<SerializedScene | null> {
    if (!isValidSceneName(name)) {
      throw new Error(`scene-storage load: invalid name "${name}"`);
    }
    const r = await fetch(`${this.base}/${encodeURIComponent(name)}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`scene-storage load: ${r.status}`);
    const raw = (await r.json()) as unknown;
    return deserializeScene(raw);
  }

  async save(name: string, scene: SerializedScene): Promise<void> {
    if (!isValidSceneName(name)) {
      throw new Error(`scene-storage save: invalid name "${name}"`);
    }
    const r = await fetch(`${this.base}/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(scene),
    });
    if (!r.ok) throw new Error(`scene-storage save: ${r.status}`);
  }

  async delete(name: string): Promise<void> {
    if (!isValidSceneName(name)) {
      throw new Error(`scene-storage delete: invalid name "${name}"`);
    }
    const r = await fetch(`${this.base}/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
    if (!r.ok && r.status !== 404) {
      throw new Error(`scene-storage delete: ${r.status}`);
    }
  }
}
