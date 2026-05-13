import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin, ViteDevServer } from 'vite';
import type { Connect } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isValidSceneName } from './src/scenes/storage.ts';
import { deserializeScene, type SerializedScene } from './src/scenes/serialize.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCENES_DIR = path.resolve(HERE, 'scenes');

export interface SceneStoragePluginOptions {
  /**
   * Directory on disk where scene JSON files live. Defaults to
   * `packages/world/scenes/` (resolved relative to this file).
   * Can be overridden for testing or to host studio against an
   * alternative content tree.
   */
  scenesDir?: string;
  /**
   * URL prefix the middleware listens on. Defaults to `/api/scenes`.
   * Must match the `basePath` passed to `FilesystemSceneStorage`.
   */
  basePath?: string;
}

/**
 * Vite plugin that exposes a tiny REST surface for authoring scenes.
 *
 *   GET    /api/scenes              → { scenes: SceneSummary[] }
 *   GET    /api/scenes/:name        → SerializedScene | 404
 *   PUT    /api/scenes/:name        → 204 (body = SerializedScene JSON)
 *   DELETE /api/scenes/:name        → 204
 *
 * Files are stored as `scenesDir/<name>.json`. Names are slugged
 * through {@link isValidSceneName} on every request to keep
 * filesystem traversal off the table — `..`, slashes, and other
 * funky characters are rejected with 400.
 *
 * **Dev-only.** Vite plugins don't run in production builds, so
 * studio falls back to `LocalStorageSceneStorage` when there's no
 * dev server. That's deliberate: the production target for authored
 * scenes is the future Supabase adapter, not the browser-served
 * filesystem.
 */
export default function sceneStoragePlugin(
  opts: SceneStoragePluginOptions = {},
): Plugin {
  const scenesDir = opts.scenesDir ?? DEFAULT_SCENES_DIR;
  const basePath = (opts.basePath ?? '/api/scenes').replace(/\/$/, '');

  return {
    name: 'officexr:scene-storage',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(basePath, makeMiddleware(scenesDir));
    },
  };
}

function makeMiddleware(scenesDir: string): Connect.NextHandleFunction {
  return async (req, res, next) => {
    try {
      // Note: req.url here is RELATIVE to the middleware mount point
      // (Vite's `use(basePath, ...)` rewrites it). So `/api/scenes`
      // arrives as `/`, `/api/scenes/foo` as `/foo`.
      const url = new URL(req.url ?? '/', 'http://localhost');
      const slug = url.pathname.replace(/^\/+/, '');

      if (!slug) {
        if (req.method === 'GET') return await handleList(scenesDir, res);
        return badMethod(res, ['GET']);
      }

      if (!isValidSceneName(slug)) {
        return jsonResponse(res, 400, { error: 'invalid scene name' });
      }

      switch (req.method) {
        case 'GET':
          return await handleGet(scenesDir, slug, res);
        case 'PUT':
          return await handlePut(req, scenesDir, slug, res);
        case 'DELETE':
          return await handleDelete(scenesDir, slug, res);
        default:
          return badMethod(res, ['GET', 'PUT', 'DELETE']);
      }
    } catch (err) {
      // Don't tear down the dev server — log and 500 so the next
      // request still works.
      console.error('[scene-storage] middleware error:', err);
      jsonResponse(res, 500, { error: (err as Error).message });
      next?.();
    }
  };
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function handleList(scenesDir: string, res: ServerResponse): Promise<void> {
  await ensureDir(scenesDir);
  const entries = await fs.readdir(scenesDir);
  const scenes: Array<{ name: string; title?: string; updatedAt?: number }> = [];
  for (const file of entries) {
    if (!file.endsWith('.json')) continue;
    const name = file.replace(/\.json$/, '');
    if (!isValidSceneName(name)) continue;
    try {
      const stat = await fs.stat(path.join(scenesDir, file));
      const raw = await fs.readFile(path.join(scenesDir, file), 'utf8');
      const parsed = deserializeScene(JSON.parse(raw));
      scenes.push({
        name,
        title: parsed.title,
        updatedAt: parsed.updatedAt ?? stat.mtimeMs,
      });
    } catch (err) {
      // Don't fail the whole list because one file is corrupt — log
      // and skip it.
      console.warn(`[scene-storage] skipping ${file}:`, (err as Error).message);
    }
  }
  jsonResponse(res, 200, { scenes });
}

async function handleGet(
  scenesDir: string,
  slug: string,
  res: ServerResponse,
): Promise<void> {
  const file = path.join(scenesDir, `${slug}.json`);
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
  scenesDir: string,
  slug: string,
  res: ServerResponse,
): Promise<void> {
  const body = await readBody(req);
  let parsed: SerializedScene;
  try {
    parsed = deserializeScene(JSON.parse(body));
  } catch (err) {
    return jsonResponse(res, 400, { error: (err as Error).message });
  }
  // Force the on-disk slug to match the URL — prevents an editor from
  // saving "kitchen.json" with `name: "bedroom"` inside.
  parsed.name = slug;
  parsed.updatedAt = Date.now();
  await ensureDir(scenesDir);
  const file = path.join(scenesDir, `${slug}.json`);
  await fs.writeFile(file, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
  res.statusCode = 204;
  res.end();
}

async function handleDelete(
  scenesDir: string,
  slug: string,
  res: ServerResponse,
): Promise<void> {
  const file = path.join(scenesDir, `${slug}.json`);
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
      // Refuse > 5 MB; an authored scene of that size is almost
      // certainly an editor bug, and we don't want to OOM the dev
      // server.
      if (data.length > 5_000_000) {
        reject(new Error('scene payload exceeds 5 MB'));
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
