import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import studioStorage, {
  STORAGE_ENTRIES,
  dataDirOptions,
} from '../../vite-plugin-storage.ts';

type Handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => unknown;

async function serve(options: Parameters<typeof studioStorage>[0]) {
  const mounts: Array<[string, Handler]> = [];
  const plugin = studioStorage(options);
  (plugin.configureServer as (s: unknown) => void)({
    middlewares: { use: (base: string, h: Handler) => mounts.push([base, h]) },
  });
  const server: Server = createServer((req, res) => {
    const mount = mounts.find(([base]) => req.url?.startsWith(base));
    if (!mount) {
      res.statusCode = 404;
      res.end();
      return;
    }
    req.url = req.url!.slice(mount[0].length) || '/';
    void mount[1](req, res, () => {});
  });
  await new Promise<void>((r) => server.listen(0, r));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

const BASE_PATHS = ['/api/rooms', '/api/maps', '/api/layouts', '/api/baked-layouts', '/api/scenes'];

describe('studio storage plugin', () => {
  let dataDir: string | undefined;
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise((r) => (server ? server.close(r) : r(undefined)));
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
    }
    dataDir = undefined;
  });

  async function setup(readOnly: boolean) {
    const dir = await mkdtemp(path.join(tmpdir(), 'studio-storage-'));
    dataDir = dir;
    for (const { kind, name } of Object.values(STORAGE_ENTRIES)) {
      if (kind === 'dir') {
        await mkdir(path.join(dir, name));
      }
    }
    await writeFile(path.join(dir, 'world-object-kinds.json'), '{}');
    await writeFile(path.join(dir, 'maps', 'x.json'), '{}');
    const s = await serve({ dataDir: dir, readOnly });
    server = s.server;
    return s.url;
  }

  it('dataDir expands to the per-entry paths under it', () => {
    expect(dataDirOptions('/d')).toEqual({
      rooms: { dir: '/d/rooms' },
      maps: { dir: '/d/maps' },
      layouts: { dir: '/d/layouts' },
      bakedLayouts: { dir: '/d/baked-layouts' },
      legacyScenes: { dir: '/d/scenes' },
      catalog: { file: '/d/world-object-kinds.json' },
    });
  });

  it('serves reads and rejects writes with 405 when readOnly', async () => {
    const url = await setup(true);
    for (const base of [...BASE_PATHS, '/api/world-object-kinds']) {
      const get = await fetch(`${url}${base}/x`);
      expect(get.status, `GET ${base}`).not.toBe(405);
      if (base === '/api/maps') {
        expect(get.status).toBe(200);
      }
      for (const method of ['PUT', 'DELETE', 'POST']) {
        const res = await fetch(`${url}${base}/x`, { method, body: method === 'DELETE' ? undefined : '{}' });
        expect(res.status, `${method} ${base}`).toBe(405);
      }
    }
  });

  it('still writes when not readOnly', async () => {
    const url = await setup(false);
    const res = await fetch(`${url}/api/layouts/x`, { method: 'DELETE' });
    expect(res.status).toBe(204);
  });
});
