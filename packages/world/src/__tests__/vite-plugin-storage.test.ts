import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_WORLD_CONSTANTS, type WorldConstants } from '@officexr/sdk';
import studioStorage, {
  STORAGE_ENTRIES,
  dataDirOptions,
} from '../../vite-plugin-storage.ts';
import { newPlaceObject } from '../scenes/commands.ts';
import { emptyMapDocument, type MapDocumentV1 } from '../scenes/map-document.ts';
import { serializeRoom } from '../scenes/serialize.ts';

type Handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => unknown;

async function serve(options: Parameters<typeof studioStorage>[0]) {
  const mounts: Array<[string, Handler]> = [];
  const plugin = studioStorage(options);
  await (plugin.configureServer as (s: unknown) => Promise<void>)({
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
      worldSettings: { file: '/d/world-settings.json' },
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

describe('studio storage plugin: /api/world-settings', () => {
  let dataDir: string;
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise((r) => (server ? server.close(r) : r(undefined)));
    server = undefined;
    await rm(dataDir, { recursive: true, force: true });
  });

  async function setup(opts: {
    readOnly?: boolean;
    onSaved?: (doc: WorldConstants) => Promise<Array<{ target: string; status?: number }>>;
  }) {
    dataDir = await mkdtemp(path.join(tmpdir(), 'studio-world-settings-'));
    const s = await serve({
      dataDir,
      readOnly: opts.readOnly,
      worldSettings: { onSaved: opts.onSaved },
    });
    server = s.server;
    return s.url + '/api/world-settings';
  }

  const put = (url: string, body: unknown) =>
    fetch(url, { method: 'PUT', body: JSON.stringify(body) });
  const file = () => path.join(dataDir, 'world-settings.json');

  it('is 404 before a save and serves the saved doc after', async () => {
    const url = await setup({});
    expect((await fetch(url)).status).toBe(404);
    expect((await put(url, DEFAULT_WORLD_CONSTANTS)).status).toBe(204);
    expect(await (await fetch(url)).json()).toEqual(DEFAULT_WORLD_CONSTANTS);
  });

  it('rejects an invalid doc with 400 and leaves the file untouched', async () => {
    const url = await setup({});
    await put(url, DEFAULT_WORLD_CONSTANTS);
    const before = await readFile(file(), 'utf8');
    expect((await put(url, { animation: {} })).status).toBe(400);
    expect(await readFile(file(), 'utf8')).toBe(before);
  });

  it('calls the hook with the parsed doc', async () => {
    const docs: WorldConstants[] = [];
    const url = await setup({
      onSaved: async (doc) => {
        docs.push(doc);
        return [];
      },
    });
    await put(url, DEFAULT_WORLD_CONSTANTS);
    expect(docs).toEqual([DEFAULT_WORLD_CONSTANTS]);
  });

  it('answers 502 with the failed targets but keeps the saved file', async () => {
    const failed = [{ target: 'http://rt', status: 401 }];
    const url = await setup({ onSaved: async () => failed });
    const res = await put(url, DEFAULT_WORLD_CONSTANTS);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ failed });
    expect(JSON.parse(await readFile(file(), 'utf8'))).toEqual(DEFAULT_WORLD_CONSTANTS);
  });

  it('serves GET but rejects PUT with 405 when readOnly', async () => {
    const url = await setup({ readOnly: true });
    await writeFile(file(), JSON.stringify(DEFAULT_WORLD_CONSTANTS));
    expect((await fetch(url)).status).toBe(200);
    expect((await put(url, DEFAULT_WORLD_CONSTANTS)).status).toBe(405);
  });
});

describe('studio storage plugin: GET /api/baked-layouts', () => {
  let dir: string;
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise((r) => (server ? server.close(r) : r(undefined)));
    server = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  async function list(bakedDir: string) {
    const s = await serve({ dataDir: dir, bakedLayouts: { dir: bakedDir } });
    server = s.server;
    return (await (await fetch(`${s.url}/api/baked-layouts`)).json()) as { bakedLayouts: Array<{ name: string; size: number }> };
  }

  it('is empty when the directory is missing', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'studio-baked-'));
    expect(await list(path.join(dir, 'absent'))).toEqual({ bakedLayouts: [] });
  });

  it('lists only regular .glb files with valid names', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'studio-baked-'));
    const baked = path.join(dir, 'baked');
    await mkdir(path.join(baked, 'dir.glb'), { recursive: true });
    await writeFile(path.join(baked, 'hall.glb'), 'abc');
    await writeFile(path.join(baked, 'has space.glb'), 'x');
    await writeFile(path.join(baked, 'notes.txt'), 'x');
    const { bakedLayouts } = await list(baked);
    expect(bakedLayouts.map(({ name, size }) => ({ name, size }))).toEqual([{ name: 'hall', size: 3 }]);
  });
});

describe('studio storage plugin: map schema v2 migration', () => {
  let dataDir: string;
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise((r) => (server ? server.close(r) : r(undefined)));
    server = undefined;
    await rm(dataDir, { recursive: true, force: true });
  });

  const v1Map: MapDocumentV1 = {
    ...emptyMapDocument('old'),
    schemaVersion: 1,
    rooms: [
      { id: 'baked', roomName: 'hall', position: [-24, 0, -23], rotationY: 3 },
      { id: 'cubes', roomName: 'kitchen', position: [10, 0, 5], rotationY: 1 },
      { id: 'ghost', roomName: 'missing', position: [3, 0, 3] },
    ],
    spawnPoints: [{ id: 's', position: [1.5, 0, 1.5] }],
  };
  const v2Text = JSON.stringify({
    ...emptyMapDocument('new'),
    rooms: [{ id: 'baked', roomName: 'hall', position: [4, 0, 4], rotationY: 1 }],
  });
  const readMap = async (name: string) => readFile(path.join(dataDir, 'maps', `${name}.json`), 'utf8');

  async function boot(readOnly: boolean) {
    await new Promise((r) => (server ? server.close(r) : r(undefined)));
    const s = await serve({ dataDir, readOnly });
    server = s.server;
    return s.url;
  }

  async function setup() {
    dataDir = await mkdtemp(path.join(tmpdir(), 'studio-map-migration-'));
    await mkdir(path.join(dataDir, 'rooms'));
    await mkdir(path.join(dataDir, 'maps'));
    const room = (name: string, commands: ReturnType<typeof newPlaceObject>[], layoutName?: string) =>
      writeFile(path.join(dataDir, 'rooms', `${name}.json`), JSON.stringify(serializeRoom({ name, commands, layoutName })));
    await room('hall', [], 'hall');
    await room('kitchen', [newPlaceObject({ kindId: 'stone', position: [0, 0, 0] })]);
    await writeFile(path.join(dataDir, 'maps', 'old.json'), JSON.stringify(v1Map));
    await writeFile(path.join(dataDir, 'maps', 'new.json'), v2Text);
  }

  it('rewrites v1 maps to v2 on boot, even read-only, resetting only baked placements', async () => {
    await setup();
    await boot(true);
    const migrated = JSON.parse(await readMap('old'));
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.rooms).toEqual([
      { id: 'baked', roomName: 'hall', position: [0, 0, 0], rotationY: 0 },
      v1Map.rooms[1],
      v1Map.rooms[2],
    ]);
    expect(migrated.spawnPoints).toEqual(v1Map.spawnPoints);
    expect(await readMap('new')).toBe(v2Text);
  });

  it('is idempotent across boots', async () => {
    await setup();
    await boot(true);
    const once = await readMap('old');
    await boot(true);
    expect(await readMap('old')).toBe(once);
  });

  it('leaves a map at v1, and refuses its PUT, while a room it places is unreadable', async () => {
    await setup();
    await writeFile(path.join(dataDir, 'rooms', 'hall.json'), '{ not json');
    const url = await boot(false);
    expect(JSON.parse(await readMap('old')).schemaVersion).toBe(1);
    const res = await fetch(`${url}/api/maps/put`, { method: 'PUT', body: JSON.stringify(v1Map) });
    expect(res.status).toBe(500);
    await expect(readMap('put')).rejects.toThrow(/ENOENT/);
  });

  it('round-trips a voiceZone placement through PUT and GET', async () => {
    await setup();
    const url = await boot(false);
    const map = {
      ...emptyMapDocument('zoned'),
      rooms: [{ id: 'k', roomName: 'kitchen', position: [0, 0, 0], voiceZone: true }],
    };
    const put = await fetch(`${url}/api/maps/zoned`, { method: 'PUT', body: JSON.stringify(map) });
    expect(put.status).toBe(204);
    const got = await (await fetch(`${url}/api/maps/zoned`)).json();
    expect(got.rooms[0].voiceZone).toBe(true);
  });

  it('stores a v1 PUT as migrated v2', async () => {
    await setup();
    const url = await boot(false);
    const res = await fetch(`${url}/api/maps/put`, { method: 'PUT', body: JSON.stringify(v1Map) });
    expect(res.status).toBe(204);
    const stored = JSON.parse(await readMap('put'));
    expect(stored.schemaVersion).toBe(2);
    expect(stored.rooms[0]).toEqual({ id: 'baked', roomName: 'hall', position: [0, 0, 0], rotationY: 0 });
    expect(stored.rooms[1]).toEqual(v1Map.rooms[1]);
  });
});
