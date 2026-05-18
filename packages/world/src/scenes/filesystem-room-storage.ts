import {
  deserializeScene,
  migrateToV3,
  migrateToV5,
  type SerializedScene,
} from './serialize.ts';
import { isValidSceneName } from './storage.ts';
import type { RoomDocument } from './commands.ts';
import type { SceneSummary } from './storage.ts';

export type RoomSummary = SceneSummary;

/**
 * Pluggable room storage. Mirrors `SceneStorage` but typed for the new
 * v3 `RoomDocument`. The filesystem and localStorage implementations
 * always migrate inputs through `migrateToV3`, so callers get a v3
 * doc back regardless of how old the on-disk file is.
 */
export interface RoomStorage {
  list(): Promise<RoomSummary[]>;
  load(name: string): Promise<RoomDocument | null>;
  save(name: string, room: RoomDocument): Promise<void>;
  delete(name: string): Promise<void>;
}

/**
 * Talks to the Vite middleware at `/api/rooms` (mounted by
 * `vite-plugin-storage.ts`). Always returns a migrated v3
 * `RoomDocument` so callers never see legacy shapes.
 */
export class FilesystemRoomStorage implements RoomStorage {
  private base: string;

  constructor(opts: { basePath?: string } = {}) {
    this.base = (opts.basePath ?? '/api/rooms').replace(/\/$/, '');
  }

  async list(): Promise<RoomSummary[]> {
    const r = await fetch(this.base, { method: 'GET' });
    if (!r.ok) throw new Error(`room-storage list: ${r.status}`);
    const json = (await r.json()) as { rooms?: RoomSummary[] };
    return Array.isArray(json.rooms) ? json.rooms : [];
  }

  async load(name: string): Promise<RoomDocument | null> {
    if (!isValidSceneName(name)) {
      throw new Error(`room-storage load: invalid name "${name}"`);
    }
    const r = await fetch(`${this.base}/${encodeURIComponent(name)}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`room-storage load: ${r.status}`);
    const raw = (await r.json()) as unknown;
    const parsed: SerializedScene = deserializeScene(raw);
    return migrateToV5(parsed);
  }

  async save(name: string, room: RoomDocument): Promise<void> {
    if (!isValidSceneName(name)) {
      throw new Error(`room-storage save: invalid name "${name}"`);
    }
    const r = await fetch(`${this.base}/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(room),
    });
    if (!r.ok) throw new Error(`room-storage save: ${r.status}`);
  }

  async delete(name: string): Promise<void> {
    if (!isValidSceneName(name)) {
      throw new Error(`room-storage delete: invalid name "${name}"`);
    }
    const r = await fetch(`${this.base}/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
    if (!r.ok && r.status !== 404) {
      throw new Error(`room-storage delete: ${r.status}`);
    }
  }
}
