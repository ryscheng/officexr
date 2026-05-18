import { deserializeLayout } from './layout-document.ts';
import { isValidSceneName, type SceneSummary } from './storage.ts';
import type { LayoutDocument } from './layout-document.ts';

export type LayoutSummary = SceneSummary;

/**
 * Pluggable layout storage. Symmetric with `RoomStorage` and `MapStorage`
 * but typed for `LayoutDocument`. Only JSON layouts are handled here;
 * baked GLBs are binary artifacts served via `/api/baked-layouts/:name`
 * and have no localStorage counterpart.
 */
export interface LayoutStorage {
  list(): Promise<LayoutSummary[]>;
  load(name: string): Promise<LayoutDocument | null>;
  save(name: string, layout: LayoutDocument): Promise<void>;
  delete(name: string): Promise<void>;
}

/** Talks to the Vite middleware at `/api/layouts`. */
export class FilesystemLayoutStorage implements LayoutStorage {
  private base: string;

  constructor(opts: { basePath?: string } = {}) {
    this.base = (opts.basePath ?? '/api/layouts').replace(/\/$/, '');
  }

  async list(): Promise<LayoutSummary[]> {
    const r = await fetch(this.base, { method: 'GET' });
    if (!r.ok) throw new Error(`layout-storage list: ${r.status}`);
    const json = (await r.json()) as { layouts?: LayoutSummary[] };
    return Array.isArray(json.layouts) ? json.layouts : [];
  }

  async load(name: string): Promise<LayoutDocument | null> {
    if (!isValidSceneName(name)) {
      throw new Error(`layout-storage load: invalid name "${name}"`);
    }
    const r = await fetch(`${this.base}/${encodeURIComponent(name)}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`layout-storage load: ${r.status}`);
    return deserializeLayout((await r.json()) as unknown);
  }

  async save(name: string, layout: LayoutDocument): Promise<void> {
    if (!isValidSceneName(name)) {
      throw new Error(`layout-storage save: invalid name "${name}"`);
    }
    const r = await fetch(`${this.base}/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(layout),
    });
    if (!r.ok) throw new Error(`layout-storage save: ${r.status}`);
  }

  async delete(name: string): Promise<void> {
    if (!isValidSceneName(name)) {
      throw new Error(`layout-storage delete: invalid name "${name}"`);
    }
    const r = await fetch(`${this.base}/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
    if (!r.ok && r.status !== 404) {
      throw new Error(`layout-storage delete: ${r.status}`);
    }
  }
}
