import { deserializeMap } from './serialize.ts';
import { isValidSceneName, type SceneSummary } from './storage.ts';
import type { MapDocumentV1 } from './map-document.ts';

export type MapSummary = SceneSummary;

/**
 * Pluggable map storage. Symmetric with `RoomStorage` but typed for
 * `MapDocumentV1`. Maps have a single schemaVersion so no migration
 * step is needed.
 */
export interface MapStorage {
  list(): Promise<MapSummary[]>;
  load(name: string): Promise<MapDocumentV1 | null>;
  save(name: string, map: MapDocumentV1): Promise<void>;
  delete(name: string): Promise<void>;
}

/** Talks to the Vite middleware at `/api/maps`. */
export class FilesystemMapStorage implements MapStorage {
  private base: string;

  constructor(opts: { basePath?: string } = {}) {
    this.base = (opts.basePath ?? '/api/maps').replace(/\/$/, '');
  }

  async list(): Promise<MapSummary[]> {
    const r = await fetch(this.base, { method: 'GET' });
    if (!r.ok) throw new Error(`map-storage list: ${r.status}`);
    const json = (await r.json()) as { maps?: MapSummary[] };
    return Array.isArray(json.maps) ? json.maps : [];
  }

  async load(name: string): Promise<MapDocumentV1 | null> {
    if (!isValidSceneName(name)) {
      throw new Error(`map-storage load: invalid name "${name}"`);
    }
    const r = await fetch(`${this.base}/${encodeURIComponent(name)}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`map-storage load: ${r.status}`);
    return deserializeMap((await r.json()) as unknown);
  }

  async save(name: string, map: MapDocumentV1): Promise<void> {
    if (!isValidSceneName(name)) {
      throw new Error(`map-storage save: invalid name "${name}"`);
    }
    const r = await fetch(`${this.base}/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(map),
    });
    if (!r.ok) throw new Error(`map-storage save: ${r.status}`);
  }

  async delete(name: string): Promise<void> {
    if (!isValidSceneName(name)) {
      throw new Error(`map-storage delete: invalid name "${name}"`);
    }
    const r = await fetch(`${this.base}/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
    if (!r.ok && r.status !== 404) {
      throw new Error(`map-storage delete: ${r.status}`);
    }
  }
}
