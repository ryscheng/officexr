import type { SerializedScene } from './serialize.ts';

/**
 * One scene the storage knows about. Used by `list()` so a UI can
 * populate a "load…" dropdown without fetching every scene's full
 * payload.
 */
export interface SceneSummary {
  /** Filename-safe slug — also the lookup key passed to `load`/`save`/`delete`. */
  name: string;
  /** Optional human label shown in pickers; defaults to `name`. */
  title?: string;
  /** Last-modified epoch ms, if the storage tracks it. */
  updatedAt?: number;
}

/**
 * Pluggable storage for authored scenes.
 *
 * Concrete implementations:
 *   - `FilesystemSceneStorage` (dev default): talks to the Vite
 *     middleware that reads/writes JSON in `packages/world/scenes/`.
 *   - `LocalStorageSceneStorage`: per-browser cache + standalone
 *     fallback for static-host previews and tests.
 *   - (future) `SupabaseSceneStorage`: persists to the same Postgres
 *     instance the production web app uses, so scenes authored in
 *     studio appear in production rooms.
 *
 * The interface is intentionally minimal — `list/load/save/delete` is
 * the LCD across filesystem, localStorage, and a database adapter.
 */
export interface SceneStorage {
  /** List every scene the storage knows about. */
  list(): Promise<SceneSummary[]>;
  /** Load a scene by name. Returns null when the name doesn't exist. */
  load(name: string): Promise<SerializedScene | null>;
  /** Persist a scene under `name`. Overwrites any existing entry. */
  save(name: string, scene: SerializedScene): Promise<void>;
  /** Remove a scene. No-op if it doesn't exist. */
  delete(name: string): Promise<void>;
}

/** Slug regex enforced by every storage implementation so a scene name
 * survives both filesystems and URL paths. Letters/digits/`-_.`. */
export const SCENE_NAME_RE = /^[A-Za-z0-9._-]+$/;

export function isValidSceneName(name: string): boolean {
  if (!name || name.length > 64) return false;
  if (!SCENE_NAME_RE.test(name)) return false;
  // `.` / `..` would match the regex but are filesystem traversal
  // tokens — block them outright.
  if (name === '.' || name === '..') return false;
  return true;
}
