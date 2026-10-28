import { bakedLayoutUrl } from './baked-layout-url.ts';
import { httpError, isValidSceneName } from './storage.ts';

export interface BakedLayoutSummary {
  name: string;
  size: number;
  updatedAt: number;
}

export interface BakedLayoutStorage {
  list(): Promise<BakedLayoutSummary[]>;
  /** The stored GLB bytes, or `null` when none is stored. */
  load(name: string): Promise<Uint8Array | null>;
  save(name: string, glb: Uint8Array): Promise<void>;
  delete(name: string): Promise<void>;
}

/** Talks to the Vite middleware at `/api/baked-layouts`. */
export class FilesystemBakedLayoutStorage implements BakedLayoutStorage {
  private base: string;

  constructor(opts: { basePath?: string } = {}) {
    this.base = (opts.basePath ?? '/api/baked-layouts').replace(/\/$/, '');
  }

  async list(): Promise<BakedLayoutSummary[]> {
    const r = await fetch(this.base);
    if (!r.ok) {
      throw await httpError('baked-layout-storage list', r);
    }
    const json = (await r.json()) as { bakedLayouts?: BakedLayoutSummary[] };
    return Array.isArray(json.bakedLayouts) ? json.bakedLayouts : [];
  }

  async load(name: string): Promise<Uint8Array | null> {
    this.checkName('load', name);
    const r = await fetch(bakedLayoutUrl(name, this.base));
    if (r.status === 404) {
      return null;
    }
    if (!r.ok) {
      throw await httpError('baked-layout-storage load', r);
    }
    return new Uint8Array(await r.arrayBuffer());
  }

  async save(name: string, glb: Uint8Array): Promise<void> {
    this.checkName('save', name);
    const r = await fetch(bakedLayoutUrl(name, this.base), {
      method: 'PUT',
      headers: { 'content-type': 'model/gltf-binary' },
      // The cast relies on callers passing ArrayBuffer-backed bytes, as gltf-transform output is.
      body: glb as Uint8Array<ArrayBuffer>,
    });
    if (!r.ok) {
      throw await httpError('baked-layout-storage save', r);
    }
  }

  async delete(name: string): Promise<void> {
    this.checkName('delete', name);
    const r = await fetch(bakedLayoutUrl(name, this.base), { method: 'DELETE' });
    if (!r.ok) {
      throw await httpError('baked-layout-storage delete', r);
    }
  }

  private checkName(op: string, name: string): void {
    if (!isValidSceneName(name)) {
      throw new Error(`baked-layout-storage ${op}: invalid name "${name}"`);
    }
  }
}
