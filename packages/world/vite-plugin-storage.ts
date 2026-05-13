import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin, ViteDevServer } from 'vite';
import type { Connect } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isValidSceneName } from './src/scenes/storage.ts';
import {
  deserializeMap,
  deserializeScene,
  type MapDocumentV1,
  type SerializedScene,
} from './src/scenes/index.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOMS_DIR = path.resolve(HERE, 'rooms');
const DEFAULT_MAPS_DIR = path.resolve(HERE, 'maps');
const DEFAULT_SCENES_DIR = path.resolve(HERE, 'scenes');
const DEFAULT_CATALOG_FILE = path.resolve(HERE, 'cube-kinds.json');

export interface StudioStoragePluginOptions {
  rooms?: { dir?: string; basePath?: string };
  maps?: { dir?: string; basePath?: string };
  /** Single-document file. Default: `packages/world/cube-kinds.json`. */
  catalog?: { file?: string; basePath?: string };
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
 *   GET    /api/cube-kinds           → catalog JSON | 404
 *   PUT    /api/cube-kinds           → 204 (body = catalog JSON)
 *
 *   GET    /api/scenes/*             → legacy (back-compat for Task <6)
 *
 * **Dev-only.** Production studio falls back to localStorage adapters.
 */
export default function studioStoragePlugin(
  opts: StudioStoragePluginOptions = {},
): Plugin {
  const roomsDir = opts.rooms?.dir ?? DEFAULT_ROOMS_DIR;
  const roomsBase = (opts.rooms?.basePath ?? '/api/rooms').replace(/\/$/, '');
  const mapsDir = opts.maps?.dir ?? DEFAULT_MAPS_DIR;
  const mapsBase = (opts.maps?.basePath ?? '/api/maps').replace(/\/$/, '');
  const catalogFile = opts.catalog?.file ?? DEFAULT_CATALOG_FILE;
  const catalogBase = (opts.catalog?.basePath ?? '/api/cube-kinds').replace(
    /\/$/,
    '',
  );
  const legacyScenesDir = opts.legacyScenes?.dir ?? DEFAULT_SCENES_DIR;
  const legacyScenesBase = (
    opts.legacyScenes?.basePath ?? '/api/scenes'
  ).replace(/\/$/, '');
  const mountLegacy = !opts.legacyScenes?.disable;

  return {
    name: 'officexr:studio-storage',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(
        roomsBase,
        makeJsonResourceMiddleware({
          dir: roomsDir,
          listKey: 'rooms',
          validate: (raw: unknown) => deserializeScene(raw),
        }),
      );
      server.middlewares.use(
        mapsBase,
        makeJsonResourceMiddleware({
          dir: mapsDir,
          listKey: 'maps',
          validate: (raw: unknown) => deserializeMap(raw),
        }),
      );
      server.middlewares.use(
        catalogBase,
        makeSingleDocumentMiddleware({ file: catalogFile }),
      );
      if (mountLegacy) {
        server.middlewares.use(
          legacyScenesBase,
          makeJsonResourceMiddleware({
            dir: legacyScenesDir,
            listKey: 'scenes',
            validate: (raw: unknown) => deserializeScene(raw),
          }),
        );
      }
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

interface SingleDocOpts {
  file: string;
}

function makeSingleDocumentMiddleware(
  opts: SingleDocOpts,
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
          // Validate JSON only — the catalog schema is Task 3.
          try {
            JSON.parse(body);
          } catch (err) {
            return jsonResponse(res, 400, { error: (err as Error).message });
          }
          await fs.mkdir(path.dirname(opts.file), { recursive: true });
          await fs.writeFile(opts.file, body, 'utf8');
          res.statusCode = 204;
          res.end();
          return;
        }
        default:
          return badMethod(res, ['GET', 'PUT']);
      }
    } catch (err) {
      console.error('[studio-storage:catalog] middleware error:', err);
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
  let parsed: SerializedScene | MapDocumentV1;
  try {
    parsed = opts.validate(JSON.parse(body)) as SerializedScene | MapDocumentV1;
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
