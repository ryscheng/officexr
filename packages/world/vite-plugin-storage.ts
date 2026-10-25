import { promises as fs, type Dirent } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import type { Connect } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
// Import directly from source modules instead of the scenes barrel.
// The barrel transitively pulls in cube-catalog.ts, which does a JSON
// import — that's fine for Vite's browser bundle (Vite handles it) but
// trips Node's strict ESM loader when this file is loaded as part of
// the Vite config. Bypassing the barrel keeps the Node-side import
// graph free of any `.json` modules.
import { isValidSceneName } from './src/scenes/storage.ts';
import {
  deserializeScene,
  type SerializedScene,
} from './src/scenes/serialize.ts';
import { deserializeMap } from './src/scenes/serialize.ts';
import { deserializeLayout } from './src/scenes/layout-document.ts';
import type { MapDocumentV1 } from './src/scenes/map-document.ts';
import type { LayoutDocument } from './src/scenes/layout-document.ts';
import { parseWorldConstants, type WorldConstants } from '@officexr/sdk';
import type { WorldConstantsPushFailure } from './src/scenes/world-constants-storage.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOMS_DIR = path.resolve(HERE, 'rooms');
const DEFAULT_MAPS_DIR = path.resolve(HERE, 'maps');
const DEFAULT_SCENES_DIR = path.resolve(HERE, 'scenes');
const DEFAULT_CATALOG_FILE = path.resolve(HERE, 'world-object-kinds.json');
const DEFAULT_WORLD_SETTINGS_FILE = path.resolve(HERE, 'world-settings.json');
const DEFAULT_LAYOUTS_DIR = path.resolve(HERE, 'layouts');
const DEFAULT_BAKED_LAYOUTS_DIR = path.resolve(HERE, 'baked-layouts');

export type StorageEntry = {
  kind: 'dir' | 'file';
  name: string;
  /** `false`: no default exists, so `seedDataDir` skips it. */
  seed?: false;
};

/** Per-entry layout of a studio data dir. */
export const STORAGE_ENTRIES = {
  rooms: { kind: 'dir', name: 'rooms' },
  maps: { kind: 'dir', name: 'maps' },
  layouts: { kind: 'dir', name: 'layouts' },
  bakedLayouts: { kind: 'dir', name: 'baked-layouts' },
  legacyScenes: { kind: 'dir', name: 'scenes' },
  catalog: { kind: 'file', name: 'world-object-kinds.json' },
  worldSettings: { kind: 'file', name: 'world-settings.json', seed: false },
} satisfies Record<string, StorageEntry>;

/** Expands a data dir into the per-entry `dir` / `file` options. */
export function dataDirOptions(dataDir: string) {
  return Object.fromEntries(
    Object.entries(STORAGE_ENTRIES).map(([key, { kind, name }]) => [
      key,
      kind === 'dir'
        ? { dir: path.join(dataDir, name) }
        : { file: path.join(dataDir, name) },
    ]),
  ) as Pick<StudioStoragePluginOptions, keyof typeof STORAGE_ENTRIES>;
}

/** Whether `name` is a map the `/api/maps` list would offer: a valid slug whose file parses as a map. */
export function studioMapExists(dataDir?: string): (name: string) => Promise<boolean> {
  const dir = (dataDir ? dataDirOptions(dataDir).maps?.dir : undefined) ?? DEFAULT_MAPS_DIR;
  return async (name) => {
    if (!isValidSceneName(name)) {
      return false;
    }
    try {
      deserializeMap(JSON.parse(await fs.readFile(path.join(dir, `${name}.json`), 'utf8')));
      return true;
    } catch {
      return false;
    }
  };
}

export interface BakedLayoutHooks {
  onSaved?: (name: string, bytes: Buffer) => Promise<void>;
  onDeleted?: (name: string) => Promise<void>;
}

export interface StudioStoragePluginOptions {
  /** Root of a studio data dir; expands to every entry's dir/file. Explicit
   * per-entry options win over it. */
  dataDir?: string;
  /** Reject every request except GET/HEAD with 405. */
  readOnly?: boolean;
  rooms?: { dir?: string; basePath?: string };
  maps?: { dir?: string; basePath?: string };
  /** Single-document file. Default: `packages/world/world-object-kinds.json`. */
  catalog?: { file?: string; basePath?: string };
  /**
   * Single-document file, absent until first saved. `onSaved` runs after the
   * file is written and returns the targets it failed to reach; any failure
   * turns the PUT into a 502. Default: `packages/world/world-settings.json`.
   */
  worldSettings?: {
    file?: string;
    basePath?: string;
    onSaved?: (doc: WorldConstants) => Promise<WorldConstantsPushFailure[]>;
  };
  /** Layout JSON docs. Default dir: `packages/world/layouts/`. */
  layouts?: { dir?: string; basePath?: string };
  /**
   * Baked GLBs. Default dir: `packages/world/baked-layouts/`. `onSaved` /
   * `onDeleted` run after the file is written / removed; the response does
   * not wait for them and a rejection is only logged.
   */
  bakedLayouts?: { dir?: string; basePath?: string } & BakedLayoutHooks;
  /**
   * Back-compat: the legacy `/api/scenes` endpoint serves
   * `packages/world/scenes/` so the existing Scenes editor keeps
   * working through Task 5 of the studio restructure. Set
   * `disable: true` to skip mounting it.
   */
  legacyScenes?: { dir?: string; basePath?: string; disable?: boolean };
}

/**
 * Vite plugin that exposes the studio's authoring REST surface.
 *
 *   GET    /api/rooms                → { rooms: ResourceSummary[] }
 *   GET    /api/rooms/:name          → SerializedScene | 404
 *   PUT    /api/rooms/:name          → 204 (body = SerializedScene)
 *   DELETE /api/rooms/:name          → 204
 *
 *   GET    /api/maps                 → { maps: ResourceSummary[] }
 *   GET    /api/maps/:name           → MapDocumentV1 | 404
 *   PUT    /api/maps/:name           → 204 (body = MapDocumentV1)
 *   DELETE /api/maps/:name           → 204
 *
 *   GET    /api/world-object-kinds   → catalog JSON | 404
 *   PUT    /api/world-object-kinds   → 204 (body = catalog JSON)
 *
 *   GET    /api/world-settings       → WorldConstants JSON | 404
 *   PUT    /api/world-settings       → 204 | 400 | 502 { failed } (body = WorldConstants JSON)
 *
 *   GET    /api/scenes/*             → legacy (back-compat for Task <6)
 *
 * Mounted on both the dev and preview servers.
 */
export default function studioStoragePlugin(
  options: StudioStoragePluginOptions = {},
): Plugin {
  const fromDataDir = options.dataDir ? dataDirOptions(options.dataDir) : {};
  const opts = {
    ...options,
    rooms: { ...fromDataDir.rooms, ...options.rooms },
    maps: { ...fromDataDir.maps, ...options.maps },
    layouts: { ...fromDataDir.layouts, ...options.layouts },
    bakedLayouts: { ...fromDataDir.bakedLayouts, ...options.bakedLayouts },
    legacyScenes: { ...fromDataDir.legacyScenes, ...options.legacyScenes },
    catalog: { ...fromDataDir.catalog, ...options.catalog },
    worldSettings: { ...fromDataDir.worldSettings, ...options.worldSettings },
  };
  const roomsDir = opts.rooms?.dir ?? DEFAULT_ROOMS_DIR;
  const roomsBase = (opts.rooms?.basePath ?? '/api/rooms').replace(/\/$/, '');
  const mapsDir = opts.maps?.dir ?? DEFAULT_MAPS_DIR;
  const mapsBase = (opts.maps?.basePath ?? '/api/maps').replace(/\/$/, '');
  const catalogFile = opts.catalog?.file ?? DEFAULT_CATALOG_FILE;
  const catalogBase = (opts.catalog?.basePath ?? '/api/world-object-kinds').replace(
    /\/$/,
    '',
  );
  const worldSettingsFile = opts.worldSettings.file ?? DEFAULT_WORLD_SETTINGS_FILE;
  const worldSettingsBase = (opts.worldSettings.basePath ?? '/api/world-settings').replace(
    /\/$/,
    '',
  );
  const layoutsDir = opts.layouts?.dir ?? DEFAULT_LAYOUTS_DIR;
  const layoutsBase = (opts.layouts?.basePath ?? '/api/layouts').replace(/\/$/, '');
  const bakedLayoutsDir = opts.bakedLayouts?.dir ?? DEFAULT_BAKED_LAYOUTS_DIR;
  const bakedLayoutsBase = (opts.bakedLayouts?.basePath ?? '/api/baked-layouts').replace(
    /\/$/,
    '',
  );
  const legacyScenesDir = opts.legacyScenes?.dir ?? DEFAULT_SCENES_DIR;
  const legacyScenesBase = (
    opts.legacyScenes?.basePath ?? '/api/scenes'
  ).replace(/\/$/, '');
  const mountLegacy = !opts.legacyScenes?.disable;

  const mountStorage = (server: Connect.Server) => {
    const use = (base: string, handler: Connect.NextHandleFunction) =>
      server.use(base, (req, res, next) => {
        if (opts.readOnly && req.method !== 'GET' && req.method !== 'HEAD') {
          return badMethod(res, ['GET', 'HEAD']);
        }
        return handler(req, res, next);
      });
    use(
      roomsBase,
      makeJsonResourceMiddleware({
        dir: roomsDir,
        listKey: 'rooms',
        validate: (raw: unknown) => deserializeScene(raw),
      }),
    );
    use(
      mapsBase,
      makeJsonResourceMiddleware({
        dir: mapsDir,
        listKey: 'maps',
        validate: (raw: unknown) => deserializeMap(raw),
      }),
    );
    use(
      catalogBase,
      makeSingleDocumentMiddleware({ file: catalogFile, label: 'catalog' }),
    );
    use(
      worldSettingsBase,
      makeSingleDocumentMiddleware({
        file: worldSettingsFile,
        label: 'world-settings',
        validate: parseWorldConstants,
        onSaved: opts.worldSettings.onSaved,
      }),
    );
    use(
      layoutsBase,
      makeJsonResourceMiddleware({
        dir: layoutsDir,
        listKey: 'layouts',
        validate: (raw: unknown) => deserializeLayout(raw),
      }),
    );
    use(
      bakedLayoutsBase,
      makeBinaryResourceMiddleware({ ...opts.bakedLayouts, dir: bakedLayoutsDir }),
    );
    if (mountLegacy) {
      use(
        legacyScenesBase,
        makeJsonResourceMiddleware({
          dir: legacyScenesDir,
          listKey: 'scenes',
          validate: (raw: unknown) => deserializeScene(raw),
        }),
      );
    }
  };

  return {
    name: 'officexr:studio-storage',
    configureServer(server) {
      mountStorage(server.middlewares);
    },
    configurePreviewServer(server) {
      mountStorage(server.middlewares);
    },
  };
}

interface ResourceSummary {
  name: string;
  title?: string;
  updatedAt?: number;
}

interface JsonResourceOpts {
  dir: string;
  listKey: string;
  validate: (raw: unknown) => { name: string; title?: string; updatedAt?: number };
}

function makeJsonResourceMiddleware(
  opts: JsonResourceOpts,
): Connect.NextHandleFunction {
  return async (req, res, next) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const slug = url.pathname.replace(/^\/+/, '');

      if (!slug) {
        if (req.method === 'GET') return await handleList(opts, res);
        return badMethod(res, ['GET']);
      }

      if (!isValidSceneName(slug)) {
        return jsonResponse(res, 400, { error: 'invalid resource name' });
      }

      switch (req.method) {
        case 'GET':
          return await handleGet(opts.dir, slug, res);
        case 'PUT':
          return await handlePut(req, opts, slug, res);
        case 'DELETE':
          return await handleDelete(opts.dir, slug, res);
        default:
          return badMethod(res, ['GET', 'PUT', 'DELETE']);
      }
    } catch (err) {
      console.error(`[studio-storage:${opts.listKey}] middleware error:`, err);
      jsonResponse(res, 500, { error: (err as Error).message });
      next?.();
    }
  };
}

interface BinaryResourceOpts extends BakedLayoutHooks {
  dir: string;
}

/**
 * Middleware for binary GLB files.
 *
 *   GET  /api/baked-layouts/:name  → application/octet-stream or 404
 *   PUT  /api/baked-layouts/:name  → 204 (body = binary GLB)
 *   DELETE /api/baked-layouts/:name → 204
 *   GET  /api/baked-layouts         → { bakedLayouts: [{ name, size, updatedAt }] }
 *
 * Names must end with `.glb` — `isValidSceneName` is checked after
 * stripping the `.glb` suffix.
 */
function makeBinaryResourceMiddleware(
  opts: BinaryResourceOpts,
): Connect.NextHandleFunction {
  return async (req, res, next) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const slug = url.pathname.replace(/^\/+/, '');

      if (!slug) {
        if (req.method === 'GET') {
          return await handleListBaked(opts.dir, res);
        }
        return badMethod(res, ['GET']);
      }

      // Names look like "foo" or "foo.glb". Normalise to bare name for
      // validation, keep the .glb extension for the actual filename.
      const bareName = slug.endsWith('.glb') ? slug.slice(0, -4) : slug;
      if (!isValidSceneName(bareName)) {
        return jsonResponse(res, 400, { error: 'invalid resource name' });
      }
      const filename = `${bareName}.glb`;
      const file = path.join(opts.dir, filename);

      switch (req.method) {
        case 'GET': {
          let data: Buffer;
          try {
            data = await fs.readFile(file);
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
              return jsonResponse(res, 404, { error: 'not found' });
            }
            throw err;
          }
          res.statusCode = 200;
          res.setHeader('content-type', 'model/gltf-binary');
          res.end(data);
          return;
        }
        case 'HEAD': {
          // Existence + size probe with no body. The inspector's bake
          // badge uses this to decide whether the GLB is on disk
          // without paying the bandwidth cost of streaming the file.
          // Spec requires HEAD to return the same headers as GET; we
          // mirror status + content-type and the file size.
          try {
            const stat = await fs.stat(file);
            res.statusCode = 200;
            res.setHeader('content-type', 'model/gltf-binary');
            res.setHeader('content-length', String(stat.size));
            res.end();
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
              res.statusCode = 404;
              res.end();
              return;
            }
            throw err;
          }
          return;
        }
        case 'PUT': {
          const data = await readBodyBinary(req);
          await ensureDir(opts.dir);
          await fs.writeFile(file, data);
          res.statusCode = 204;
          res.end();
          opts.onSaved?.(bareName, data).catch(logHookError);
          return;
        }
        case 'DELETE': {
          try {
            await fs.unlink(file);
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
          }
          res.statusCode = 204;
          res.end();
          opts.onDeleted?.(bareName).catch(logHookError);
          return;
        }
        default:
          return badMethod(res, ['GET', 'HEAD', 'PUT', 'DELETE']);
      }
    } catch (err) {
      console.error(`[studio-storage:baked-layouts] middleware error:`, err);
      jsonResponse(res, 500, { error: (err as Error).message });
      next?.();
    }
  };
}

async function handleListBaked(dir: string, res: ServerResponse): Promise<void> {
  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }
  const bakedLayouts: Array<{ name: string; size: number; updatedAt: number }> = [];
  for (const entry of entries) {
    const name = entry.name.slice(0, -4);
    if (!entry.isFile() || !entry.name.endsWith('.glb') || !isValidSceneName(name)) {
      continue;
    }
    try {
      const stat = await fs.stat(path.join(dir, entry.name));
      bakedLayouts.push({ name, size: stat.size, updatedAt: stat.mtimeMs });
    } catch (err) {
      console.warn(`[studio-storage:baked-layouts] skipping ${entry.name}:`, (err as Error).message);
    }
  }
  jsonResponse(res, 200, { bakedLayouts });
}

function logHookError(err: unknown): void {
  console.error('[studio-storage:baked-layouts] hook failed:', err);
}

interface SingleDocOpts<T> {
  file: string;
  /** Names the route in error logs. */
  label: string;
  /** Throws on an invalid document; the PUT is then a 400 and the file is untouched. */
  validate?: (raw: unknown) => T;
  /** Runs after the file is written; any returned failure makes the PUT a 502 `{failed}`. */
  onSaved?: (doc: T) => Promise<unknown[]>;
}

function makeSingleDocumentMiddleware<T = unknown>(
  opts: SingleDocOpts<T>,
): Connect.NextHandleFunction {
  return async (req, res, next) => {
    try {
      switch (req.method) {
        case 'GET': {
          let raw: string;
          try {
            raw = await fs.readFile(opts.file, 'utf8');
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
              return jsonResponse(res, 404, { error: 'not found' });
            }
            throw err;
          }
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end(raw);
          return;
        }
        case 'PUT': {
          const body = await readBody(req);
          let doc: T;
          try {
            const raw: unknown = JSON.parse(body);
            doc = opts.validate ? opts.validate(raw) : (raw as T);
          } catch (err) {
            return jsonResponse(res, 400, { error: (err as Error).message });
          }
          await fs.mkdir(path.dirname(opts.file), { recursive: true });
          // Rename so a reader never sees a half-written file.
          const tmp = `${opts.file}.${process.pid}.${Date.now()}.tmp`;
          try {
            await fs.writeFile(tmp, body, 'utf8');
            await fs.rename(tmp, opts.file);
          } catch (err) {
            await fs.unlink(tmp).catch(() => {});
            throw err;
          }
          const failed = (await opts.onSaved?.(doc)) ?? [];
          if (failed.length > 0) {
            return jsonResponse(res, 502, { failed });
          }
          res.statusCode = 204;
          res.end();
          return;
        }
        default:
          return badMethod(res, ['GET', 'PUT']);
      }
    } catch (err) {
      console.error(`[studio-storage:${opts.label}] middleware error:`, err);
      jsonResponse(res, 500, { error: (err as Error).message });
      next?.();
    }
  };
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function handleList(
  opts: JsonResourceOpts,
  res: ServerResponse,
): Promise<void> {
  await ensureDir(opts.dir);
  const entries = await fs.readdir(opts.dir);
  const out: ResourceSummary[] = [];
  for (const file of entries) {
    if (!file.endsWith('.json')) continue;
    const name = file.replace(/\.json$/, '');
    if (!isValidSceneName(name)) continue;
    try {
      const stat = await fs.stat(path.join(opts.dir, file));
      const raw = await fs.readFile(path.join(opts.dir, file), 'utf8');
      const parsed = opts.validate(JSON.parse(raw));
      out.push({
        name,
        title: parsed.title,
        updatedAt: parsed.updatedAt ?? stat.mtimeMs,
      });
    } catch (err) {
      console.warn(
        `[studio-storage:${opts.listKey}] skipping ${file}:`,
        (err as Error).message,
      );
    }
  }
  jsonResponse(res, 200, { [opts.listKey]: out });
}

async function handleGet(
  dir: string,
  slug: string,
  res: ServerResponse,
): Promise<void> {
  const file = path.join(dir, `${slug}.json`);
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return jsonResponse(res, 404, { error: 'not found' });
    }
    throw err;
  }
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json');
  res.end(raw);
}

async function handlePut(
  req: IncomingMessage,
  opts: JsonResourceOpts,
  slug: string,
  res: ServerResponse,
): Promise<void> {
  const body = await readBody(req);
  let parsed: SerializedScene | MapDocumentV1 | LayoutDocument;
  try {
    parsed = opts.validate(JSON.parse(body)) as SerializedScene | MapDocumentV1 | LayoutDocument;
  } catch (err) {
    return jsonResponse(res, 400, { error: (err as Error).message });
  }
  // Force the on-disk slug to match the URL so a save under
  // /api/rooms/kitchen can't land a doc with internal `name: "bedroom"`.
  (parsed as { name: string }).name = slug;
  (parsed as { updatedAt?: number }).updatedAt = Date.now();
  await ensureDir(opts.dir);
  const file = path.join(opts.dir, `${slug}.json`);
  await fs.writeFile(file, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
  res.statusCode = 204;
  res.end();
}

async function handleDelete(
  dir: string,
  slug: string,
  res: ServerResponse,
): Promise<void> {
  const file = path.join(dir, `${slug}.json`);
  try {
    await fs.unlink(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  res.statusCode = 204;
  res.end();
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      data += chunk;
      // Refuse > 5 MB; an authored doc of that size is almost certainly
      // an editor bug, and we don't want to OOM the dev server.
      if (data.length > 5_000_000) {
        reject(new Error('payload exceeds 5 MB'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function readBodyBinary(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      total += chunk.length;
      // Refuse > 50 MB; a baked GLB should never be that large.
      if (total > 50_000_000) {
        reject(new Error('binary payload exceeds 50 MB'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function jsonResponse(
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

function badMethod(res: ServerResponse, allow: string[]): void {
  res.statusCode = 405;
  res.setHeader('allow', allow.join(', '));
  res.end();
}
