import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DEFAULT_WORLD_CONSTANTS } from '@officexr/sdk';
import {
  emptyLayoutDocument,
  emptyMapDocument,
  emptyRoomDocument,
  InMemoryLayoutStorage,
  InMemoryMapStorage,
  InMemoryRoomStorage,
  InMemoryWorldConstantsStorage,
  WorldConstantsPushError,
  type BakedLayoutStorage,
  type CatalogStorage,
  type LayoutDocument,
  type WorldConstantsStorage,
  type WorldObjectKindCatalogV1,
  validateWorldObjectKindCatalog,
} from '@officexr/world/scenes';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HeavyWorkLock } from './heavy-work-lock.ts';
import type { BakeLayout } from './tools/baked-layouts.ts';
import type { RenderRequest, RenderResult, ViewRenderer } from './renderer.ts';
import { createStudioMcpServer, type StudioMcpOptions } from './server.ts';
import { BakeJobs } from './tools/bake-jobs.ts';
import type { StudioDocuments } from './studio-documents.ts';

class InMemoryCatalogStorage implements CatalogStorage {
  saved = 0;
  constructor(private catalog: WorldObjectKindCatalogV1 | null = null) {}
  async load() {
    return this.catalog;
  }
  async save(catalog: WorldObjectKindCatalogV1) {
    this.saved += 1;
    this.catalog = catalog;
  }
}

class InMemoryBakedLayouts implements BakedLayoutStorage {
  files = new Map<string, Uint8Array>();
  async list() {
    return [...this.files].map(([name, glb]) => ({ name, size: glb.length, updatedAt: 0 }));
  }
  async save(name: string, glb: Uint8Array) {
    this.files.set(name, glb);
  }
  async load(name: string) {
    return this.files.get(name) ?? null;
  }
  async delete(name: string) {
    this.files.delete(name);
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

class FakeRenderer implements ViewRenderer {
  requests: { origin: string; request: RenderRequest }[] = [];
  render: ViewRenderer['render'] = async (origin, request) => {
    this.requests.push({ origin, request });
    return { png: PNG_BYTES, bounds: { min: [0, 0, 0], max: [4, 2, 4] }, metresPerPixel: 0.02 };
  };
}

async function connect(
  overrides: Partial<StudioDocuments> = {},
  renderer: ViewRenderer = new FakeRenderer(),
  extra: Partial<StudioMcpOptions> = {},
) {
  const docs: StudioDocuments = {
    rooms: new InMemoryRoomStorage(),
    maps: new InMemoryMapStorage(),
    layouts: new InMemoryLayoutStorage(),
    catalog: new InMemoryCatalogStorage(),
    worldSettings: new InMemoryWorldConstantsStorage(),
    bakedLayouts: new InMemoryBakedLayouts(),
    ...overrides,
  };
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const options: StudioMcpOptions = {
    modelRoot: '/nonexistent',
    heavyWorkLock: new HeavyWorkLock('a bake or render'),
    renderer,
    bakeJobs: new BakeJobs(),
    ...extra,
  };
  await createStudioMcpServer(docs, options, 'http://studio.test').connect(serverSide);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { isError: r.isError === true, text: (r.content as { text: string }[])[0].text };
  };
  return { docs, client, call };
}

describe('studio MCP tools', () => {
  it('lists the 24 tools', async () => {
    const { client } = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        ...['room', 'map', 'layout'].flatMap((n) => [`list_${n}s`, `get_${n}`, `put_${n}`, `delete_${n}`]),
        'bake_layout',
        'list_baked_layouts',
        'delete_baked_layout',
        'check_map_bakes',
        'bake_map',
        'get_bake_job',
        'render_view',
        'get_world_object_kinds',
        'put_world_object_kinds',
        'patch_world_object_kinds',
        'get_world_settings',
        'put_world_settings',
      ].sort(),
    );
  });

  it('round-trips a room and a map that references it', async () => {
    const { call } = await connect();
    expect((await call('put_room', { name: 'hall', room: emptyRoomDocument('hall') })).isError).toBe(false);
    const map = { ...emptyMapDocument('town'), rooms: [{ id: 'a', roomName: 'hall', position: [0, 0, 0] }] };
    expect((await call('put_map', { name: 'town', map })).isError).toBe(false);
    expect(JSON.parse((await call('get_map', { name: 'town' })).text).rooms[0].roomName).toBe('hall');
    const zoned = { ...map, rooms: [{ ...map.rooms[0], voiceZone: true }] };
    expect((await call('put_map', { name: 'town', map: zoned })).isError).toBe(false);
    expect(JSON.parse((await call('get_map', { name: 'town' })).text).rooms[0].voiceZone).toBe(true);
    expect(JSON.parse((await call('list_rooms')).text)).toHaveLength(1);
    await call('delete_room', { name: 'hall' });
    expect(JSON.parse((await call('list_rooms')).text)).toHaveLength(0);
  });

  it('rejects a map referencing unknown rooms and writes nothing', async () => {
    const { call, docs } = await connect();
    const map = { ...emptyMapDocument('town'), rooms: [{ id: 'a', roomName: 'ghost', position: [0, 0, 0] }] };
    const r = await call('put_map', { name: 'town', map });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('ghost');
    expect(await docs.maps.list()).toEqual([]);
  });

  it('rejects invalid names and invalid maps and writes nothing', async () => {
    const { call, docs } = await connect();
    expect((await call('put_room', { name: '../evil', room: emptyRoomDocument('x') })).isError).toBe(true);
    expect((await call('put_map', { name: 'bad', map: { nope: true } })).isError).toBe(true);
    expect(await docs.rooms.list()).toEqual([]);
    expect(await docs.maps.list()).toEqual([]);
  });

  it('validates the catalog before writing it', async () => {
    const catalog = new InMemoryCatalogStorage();
    const { call } = await connect({ catalog });
    const r = await call('put_world_object_kinds', { catalog: { schemaVersion: 99, kinds: [] } });
    expect(r.isError).toBe(true);
    expect(catalog.saved).toBe(0);
    expect((await call('put_world_object_kinds', { catalog: { schemaVersion: 1, kinds: [] } })).isError).toBe(false);
    expect(catalog.saved).toBe(1);
  });

  describe('patch_world_object_kinds', () => {
    const kind = { id: 'crate', label: 'Crate', gltfPath: 'crate.glb', swatch: '#fff' };
    const seeded = () =>
      new InMemoryCatalogStorage(
        validateWorldObjectKindCatalog({ schemaVersion: 1, kinds: [kind, { ...kind, id: 'barrel', label: 'Barrel' }] }),
      );

    it('replaces only the given fields of the given kinds', async () => {
      const catalog = seeded();
      const before = (await catalog.load())!;
      const { call } = await connect({ catalog });
      const r = await call('patch_world_object_kinds', { kinds: [{ id: 'crate', label: 'Big crate', walkable: true }] });
      expect(r.isError).toBe(false);
      expect(JSON.parse(r.text)).toEqual({ saved: true, patched: ['crate'] });
      const after = (await catalog.load())!;
      expect(after.kinds[0]).toEqual({ ...before.kinds[0], label: 'Big crate', walkable: true });
      expect(after.kinds[1]).toEqual(before.kinds[1]);
    });

    it.each([
      ['an unknown id', [{ id: 'ghost', label: 'x' }], /no such kind: ghost/],
      ['a repeated id', [{ id: 'crate', label: 'a' }, { id: 'crate', label: 'b' }], /only once/],
      ['a patch that makes the catalog invalid', [{ id: 'barrel', rotationStepDeg: 7 }], /rotationStepDeg/],
    ])('writes nothing for %s', async (_, kinds, message) => {
      const catalog = seeded();
      const { call } = await connect({ catalog });
      const r = await call('patch_world_object_kinds', { kinds });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(message);
      expect(catalog.saved).toBe(0);
    });

    it('fails when no catalog is saved', async () => {
      const { call } = await connect();
      expect((await call('patch_world_object_kinds', { kinds: [{ id: 'crate' }] })).isError).toBe(true);
    });
  });

  describe('yaw', () => {
    const kind = { id: 'crate', label: 'Crate', gltfPath: 'crate.glb', swatch: '#fff' };
    const catalog = new InMemoryCatalogStorage(
      validateWorldObjectKindCatalog({
        schemaVersion: 1,
        kinds: [kind, { ...kind, id: 'barrel', rotationStepDeg: 15 }],
      }),
    );
    const place = (kindId: string, yawDeg?: number) => [
      { id: 'p1', op: 'placeObject', kindId, position: [0, 0, 0], ...(yawDeg !== undefined && { yawDeg }) },
    ];

    it.each([
      ['room', 'put_room', 'get_room', 'rooms', emptyRoomDocument('r')],
      ['layout', 'put_layout', 'get_layout', 'layouts', emptyLayoutDocument('r')],
    ] as const)('%s: rejects a yaw the kind does not allow and stores nothing', async (noun, put, get, store, empty) => {
      const { call, docs } = await connect({ catalog });
      const bad = await call(put, { name: 'r', [noun]: { ...empty, commands: place('crate', 45) } });
      expect(bad.isError).toBe(true);
      expect(bad.text).toMatch(/"p1".*45.*"crate".*90/);
      expect(await docs[store].list()).toEqual([]);

      const good = await call(put, { name: 'r', [noun]: { ...empty, commands: place('crate', 90) } });
      expect(good.isError).toBe(false);
      expect(JSON.parse((await call(get, { name: 'r' })).text).commands[0].yawDeg).toBe(90);
      expect((await call(put, { name: 'r', [noun]: { ...empty, commands: place('barrel', 45) } })).isError).toBe(false);
    });

    it('judges the raw yaw by its normalised value', async () => {
      const { call } = await connect({ catalog });
      const room = emptyRoomDocument('r');
      const put = (yawDeg: number) => call('put_room', { name: 'r', room: { ...room, commands: place('crate', yawDeg) } });
      expect((await put(450)).isError).toBe(false);
      expect((await put(-90)).isError).toBe(false);
      expect((await put(-45)).isError).toBe(true);
    });

    it('does not check unknown kinds, a missing catalog or placements without a yaw', async () => {
      const room = emptyRoomDocument('r');
      const put = (kindId: string, yawDeg?: number, overrides?: Partial<StudioDocuments>) =>
        connect(overrides).then(({ call }) =>
          call('put_room', { name: 'r', room: { ...room, commands: place(kindId, yawDeg) } }),
        );
      expect((await put('ghost', 45, { catalog })).isError).toBe(false);
      expect((await put('crate', 45)).isError).toBe(false);
      const stepped = new InMemoryCatalogStorage(
        validateWorldObjectKindCatalog({ schemaVersion: 1, kinds: [{ ...kind, rotationStepDeg: 360 }] }),
      );
      expect((await put('crate', undefined, { catalog: stepped })).isError).toBe(false);
      expect((await put('crate', 90, { catalog: stepped })).isError).toBe(true);
    });

    it('rejects an invalid rotationStepDeg in the catalog', async () => {
      const catalog = new InMemoryCatalogStorage();
      const { call } = await connect({ catalog });
      const r = await call('put_world_object_kinds', {
        catalog: { schemaVersion: 1, kinds: [{ ...kind, rotationStepDeg: 7 }] },
      });
      expect(r.isError).toBe(true);
      expect(r.text).toContain('rotationStepDeg');
      expect(catalog.saved).toBe(0);
    });
  });

  it('serves the default settings until some are saved', async () => {
    const { call } = await connect();
    expect(JSON.parse((await call('get_world_settings')).text)).toEqual(DEFAULT_WORLD_CONSTANTS);
  });

  it('names the failed targets when the realtime push fails', async () => {
    const worldSettings: WorldConstantsStorage = {
      load: async () => null,
      save: async () => {
        throw new WorldConstantsPushError([{ target: 'http://bots:8787', status: 500 }]);
      },
    };
    const { call } = await connect({ worldSettings });
    const r = await call('put_world_settings', { settings: DEFAULT_WORLD_CONSTANTS });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('http://bots:8787');
  });

  it('stores nothing when the layout is missing or a kind model is absent', async () => {
    const { docs, call } = await connect();
    const missing = await call('bake_layout', { name: 'nope' });
    expect(missing).toEqual({ isError: true, text: 'layout "nope" not found' });

    await docs.layouts.save('hall', {
      ...emptyLayoutDocument('hall'),
      commands: [{ op: 'placeObject', id: 'p1', kindId: 'colored_block_blue', position: [0, 0, 0] }],
    } as LayoutDocument);
    const failed = await call('bake_layout', { name: 'hall' });
    expect(failed.isError).toBe(true);
    expect(failed.text).toContain('/nonexistent/models/');
    expect(await call('list_baked_layouts')).toEqual({ isError: false, text: '[]' });
  });

  it('lists and deletes baked layouts', async () => {
    const baked = new InMemoryBakedLayouts();
    await baked.save('hall', new Uint8Array(3));
    const { call } = await connect({ bakedLayouts: baked });
    expect(JSON.parse((await call('list_baked_layouts')).text)).toEqual([{ name: 'hall', size: 3, updatedAt: 0 }]);
    expect((await call('delete_baked_layout', { name: 'hall' })).isError).toBe(false);
    expect(baked.files.size).toBe(0);
    expect((await call('delete_baked_layout', { name: '../x' })).isError).toBe(true);
  });

  describe('check_map_bakes', () => {
    const kind = { id: 'crate', label: 'Crate', gltfPath: '/crate.gltf', swatch: '#fff' };
    const crateLayout = (name: string) => ({
      ...emptyLayoutDocument(name),
      commands: [{ id: 'c1', op: 'placeObject' as const, kindId: 'crate', position: [0, 0, 0] as [number, number, number] }],
    });

    /** A minimal GLB with no bakeSource, standing in for a bake from before fingerprints. */
    const unfingerprintedGlb = () => {
      const json = new TextEncoder().encode(
        JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ extras: {} }] }).padEnd(128, ' '),
      );
      const out = new Uint8Array(20 + json.length);
      const view = new DataView(out.buffer);
      view.setUint32(0, 0x46546c67, true);
      view.setUint32(4, 2, true);
      view.setUint32(8, out.length, true);
      view.setUint32(12, json.length, true);
      view.setUint32(16, 0x4e4f534a, true);
      out.set(json, 20);
      return out;
    };

    async function setup() {
      const rooms = new InMemoryRoomStorage();
      const layouts = new InMemoryLayoutStorage();
      const maps = new InMemoryMapStorage();
      const baked = new InMemoryBakedLayouts();
      const catalogDoc = validateWorldObjectKindCatalog({ schemaVersion: 1, kinds: [kind] });
      const catalog = new InMemoryCatalogStorage(catalogDoc);
      const layoutNames = ['fresh', 'stale', 'unknown', 'absent', 'deleted'];
      for (const name of layoutNames) {
        await rooms.save(name, { ...emptyRoomDocument(name), layoutName: name });
      }
      for (const name of layoutNames.slice(0, 4)) {
        await layouts.save(name, crateLayout(name));
      }
      const { bakeLayoutGlb } = await import('@officexr/world/bake-layout-glb');
      const modelRoot = await mkdtemp(join(tmpdir(), 'check-map-bakes-'));
      const triangle = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer).toString('base64');
      await writeFile(
        join(modelRoot, 'crate.gltf'),
        JSON.stringify({
          asset: { version: '2.0' },
          scene: 0,
          scenes: [{ nodes: [0] }],
          nodes: [{ mesh: 0 }],
          meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
          accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
          bufferViews: [{ buffer: 0, byteLength: 36 }],
          buffers: [{ byteLength: 36, uri: `data:application/octet-stream;base64,${triangle}` }],
        }),
      );
      const bake = async (name: string, optimizer?: string) =>
        (await bakeLayoutGlb({ layout: crateLayout(name), modelRoot, catalog: catalogDoc, optimizer })).glb;
      await baked.save('fresh', await bake('fresh'));
      await baked.save('stale', await bake('stale', 'none'));
      await baked.save('unknown', unfingerprintedGlb());
      await rooms.save('plain', emptyRoomDocument('plain'));
      const town = {
        ...emptyMapDocument('town'),
        rooms: [
          ...[...layoutNames, 'fresh'].map((roomName, i) => ({ id: `r${i}`, roomName, position: [i, 0, 0] as [number, number, number] })),
          { id: 'p', roomName: 'plain', position: [0, 0, 9] as [number, number, number] },
        ],
      };
      await maps.save('town', town);
      await maps.save('empty', emptyMapDocument('empty'));
      return connect({ rooms, layouts, maps, catalog, bakedLayouts: baked });
    }

    it('classifies each layout of a map, grouping the rooms that share one', async () => {
      const { call } = await setup();
      const r = await call('check_map_bakes', { map: 'town' });
      expect(r.isError).toBe(false);
      const { maps, totals } = JSON.parse(r.text);
      expect(maps).toHaveLength(1);
      expect(maps[0].missingRooms).toEqual([]);
      expect(maps[0].layouts).toEqual([
        { type: 'ok', layoutName: 'fresh', status: 'fresh', roomInstanceIds: ['r0', 'r5'] },
        { type: 'ok', layoutName: 'stale', status: 'stale', roomInstanceIds: ['r1'] },
        { type: 'ok', layoutName: 'unknown', status: 'unknown', roomInstanceIds: ['r2'] },
        { type: 'ok', layoutName: 'absent', status: 'missing', roomInstanceIds: ['r3'] },
        { type: 'error', layoutName: 'deleted', error: 'layout "deleted" not found', roomInstanceIds: ['r4'] },
      ]);
      expect(totals).toEqual({ fresh: 1, stale: 1, missing: 1, unknown: 1, errors: 1 });
    });

    it('reports rooms that fail to load and checks every map with all', async () => {
      const { call, docs } = await setup();
      await docs.rooms.delete('stale');
      const { maps } = JSON.parse((await call('check_map_bakes', { all: true })).text);
      expect(maps.map((m: { map: string }) => m.map).sort()).toEqual(['empty', 'town']);
      expect(maps.find((m: { map: string }) => m.map === 'town').missingRooms).toEqual(['stale']);
    });

    it('reports a map that fails to load without failing the others', async () => {
      const { docs } = await setup();
      const maps = Object.create(docs.maps) as typeof docs.maps;
      maps.load = async (name) => {
        if (name === 'town') {
          throw new Error('disk on fire');
        }
        return docs.maps.load(name);
      };
      const { call } = await connect({ ...docs, maps });
      const { maps: results, totals } = JSON.parse((await call('check_map_bakes', { all: true })).text);
      expect(results).toContainEqual({ type: 'error', map: 'town', error: 'disk on fire' });
      expect(results).toContainEqual({ type: 'ok', map: 'empty', layouts: [], missingRooms: [] });
      expect(totals.errors).toBe(1);
    });

    it('turns a missing map into an error entry and rejects ambiguous input', async () => {
      const { call } = await setup();
      const { maps, totals } = JSON.parse((await call('check_map_bakes', { map: 'nope' })).text);
      expect(maps).toEqual([{ type: 'error', map: 'nope', error: 'map "nope" not found' }]);
      expect(totals.errors).toBe(1);
      expect((await call('check_map_bakes', {})).isError).toBe(true);
      expect((await call('check_map_bakes', { map: 'town', all: true })).isError).toBe(true);
    });
  });

  describe('bake_map', () => {
    const kind = { id: 'crate', label: 'Crate', gltfPath: '/crate.gltf', swatch: '#fff' };
    const catalogDoc = validateWorldObjectKindCatalog({ schemaVersion: 1, kinds: [kind] });
    const crateLayout = (name: string) => ({
      ...emptyLayoutDocument(name),
      commands: [{ id: 'c1', op: 'placeObject' as const, kindId: 'crate', position: [0, 0, 0] as [number, number, number] }],
    });

    class StubBake {
      baked: string[] = [];
      failing = new Set<string>();
      gate: Promise<void> | null = null;
      bake: BakeLayout = async ({ layout }) => {
        await this.gate;
        if (this.failing.has(layout.name)) {
          throw new Error(`cannot bake ${layout.name}`);
        }
        this.baked.push(layout.name);
        return { glb: new Uint8Array(layout.name.length), meta: { optimizerId: 'stub' } };
      };
    }

    async function setup(catalog = new InMemoryCatalogStorage(catalogDoc), bakedNames: string[] = []) {
      const stub = new StubBake();
      const baked = new InMemoryBakedLayouts();
      const rooms = new InMemoryRoomStorage();
      const layouts = new InMemoryLayoutStorage();
      const maps = new InMemoryMapStorage();
      const names = ['a', 'b', 'c'];
      for (const name of names) {
        await rooms.save(name, { ...emptyRoomDocument(name), layoutName: name });
        await layouts.save(name, crateLayout(name));
      }
      await maps.save('town', {
        ...emptyMapDocument('town'),
        rooms: names.map((roomName, i) => ({ id: `r${i}`, roomName, position: [i, 0, 0] as [number, number, number] })),
      });
      await maps.save('other', {
        ...emptyMapDocument('other'),
        rooms: [{ id: 'x', roomName: 'a', position: [0, 0, 0] as [number, number, number] }],
      });
      const connected = await connect(
        { rooms, layouts, maps, catalog, bakedLayouts: baked },
        undefined,
        { bakeLayout: stub.bake },
      );
      // A baked stand-in for "fresh": the real freshness check is evaluated against these bytes.
      const { bakeLayoutGlb } = await import('@officexr/world/bake-layout-glb');
      const modelRoot = await mkdtemp(join(tmpdir(), 'bake-map-'));
      const triangle = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer).toString('base64');
      await writeFile(
        join(modelRoot, 'crate.gltf'),
        JSON.stringify({
          asset: { version: '2.0' },
          scene: 0,
          scenes: [{ nodes: [0] }],
          nodes: [{ mesh: 0 }],
          meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
          accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
          bufferViews: [{ buffer: 0, byteLength: 36 }],
          buffers: [{ byteLength: 36, uri: `data:application/octet-stream;base64,${triangle}` }],
        }),
      );
      for (const name of bakedNames) {
        await baked.save(name, (await bakeLayoutGlb({ layout: crateLayout(name), modelRoot, catalog: catalogDoc })).glb);
      }
      const poll = async (jobId: string) => JSON.parse((await connected.call('get_bake_job', { jobId })).text);
      const start = async (args: Record<string, unknown>) => JSON.parse((await connected.call('bake_map', args)).text);
      const untilDone = async (jobId: string) => {
        for (;;) {
          const job = await poll(jobId);
          if (job.state === 'done') {
            return job;
          }
          await new Promise((r) => setTimeout(r, 1));
        }
      };
      const expectLockFree = async () => {
        expect((await connected.call('bake_layout', { name: 'a' })).text).not.toContain('already in progress');
      };
      return { ...connected, stub, baked, poll, start, untilDone, expectLockFree };
    }

    it('skips fresh layouts and bakes stale or missing ones', async () => {
      const { start, untilDone, stub, baked, docs } = await setup(undefined, ['a', 'b']);
      await docs.layouts.save('b', {
        ...crateLayout('b'),
        commands: [...crateLayout('b').commands, { id: 'c2', op: 'placeObject' as const, kindId: 'crate', position: [1, 0, 0] as [number, number, number] }],
      });
      const { jobId, layouts, mapErrors, missingRooms } = await start({ map: 'town' });
      expect(layouts.map((l: { action: string }) => l.action)).toEqual(['skipped', 'pending', 'pending']);
      expect([mapErrors, missingRooms]).toEqual([[], []]);
      const job = await untilDone(jobId);
      expect(job.results).toEqual([
        { layoutName: 'a', action: 'skipped' },
        { layoutName: 'b', action: 'baked', bytes: 1 },
        { layoutName: 'c', action: 'baked', bytes: 1 },
      ]);
      expect(job.totals).toEqual({ baked: 2, skipped: 1, failed: 0, pending: 0 });
      expect(stub.baked).toEqual(['b', 'c']);
      expect([...baked.files.keys()].sort()).toEqual(['a', 'b', 'c']);
    });

    it('bakes fresh layouts too with force', async () => {
      const { start, untilDone, stub } = await setup(undefined, ['a', 'b', 'c']);
      expect((await untilDone((await start({ map: 'town' })).jobId)).totals).toMatchObject({ skipped: 3, baked: 0 });
      await untilDone((await start({ map: 'town', force: true })).jobId);
      expect(stub.baked).toEqual(['a', 'b', 'c']);
    });

    it('covers every map with all, listing a shared layout once', async () => {
      const { start } = await setup();
      const { layouts } = await start({ all: true });
      expect(layouts.map((l: { layoutName: string }) => l.layoutName)).toEqual(['a', 'b', 'c']);
    });

    it('keeps baking after a layout fails and reports unresolvable layouts and maps as failed', async () => {
      const { start, untilDone, stub, docs, expectLockFree } = await setup();
      stub.failing.add('a');
      await docs.layouts.delete('c');
      const job = await untilDone((await start({ all: true })).jobId);
      expect(job.results).toEqual([
        { layoutName: 'a', action: 'failed', error: 'cannot bake a' },
        { layoutName: 'b', action: 'baked', bytes: 1 },
        { layoutName: 'c', action: 'failed', error: 'layout "c" not found' },
      ]);
      await expectLockFree();
      const missing = await start({ map: 'ghost' });
      const done = await untilDone(missing.jobId);
      expect(missing.mapErrors).toEqual([{ map: 'ghost', error: 'map "ghost" not found' }]);
      expect(done.mapErrors).toEqual(missing.mapErrors);
      expect(done.results).toEqual([]);
      await expectLockFree();
    });

    it('reports rooms that failed to load, per map', async () => {
      const { start, untilDone, docs } = await setup();
      await docs.rooms.delete('b');
      const { jobId, missingRooms } = await start({ map: 'town' });
      expect(missingRooms).toEqual([{ map: 'town', rooms: ['b'] }]);
      expect((await untilDone(jobId)).missingRooms).toEqual(missingRooms);
    });

    it('returns before the bakes finish, and holds the lock against other bakes until then', async () => {
      const { start, poll, call, stub, untilDone } = await setup();
      const gate = deferred();
      stub.gate = gate.promise;
      const { jobId } = await start({ map: 'town' });
      expect((await poll(jobId)).state).toBe('running');
      const busy = { isError: true, text: 'a bake or render is already in progress; retry shortly' };
      expect(await call('bake_map', { map: 'town' })).toEqual(busy);
      expect(await call('bake_layout', { name: 'a' })).toEqual(busy);
      gate.resolve();
      expect((await untilDone(jobId)).totals.baked).toBe(3);
      expect((await call('bake_layout', { name: 'a' })).isError).toBe(false);
    });

    it('frees the lock when the job cannot start', async () => {
      const { call, start, untilDone, expectLockFree } = await setup();
      expect((await call('bake_map', {})).isError).toBe(true);
      expect((await call('bake_map', { map: 'town', all: true })).isError).toBe(true);
      await expectLockFree();
      await untilDone((await start({ map: 'town' })).jobId);
    });

    it('errors without a catalog, freeing the lock', async () => {
      const { call, expectLockFree } = await setup(new InMemoryCatalogStorage(null));
      expect(await call('bake_map', { map: 'town' })).toEqual({ isError: true, text: 'no catalog saved' });
      await expectLockFree();
    });

    it('errors for an unknown job', async () => {
      const { call } = await setup();
      expect((await call('get_bake_job', { jobId: 'nope' })).isError).toBe(true);
    });

    it('forgets finished jobs after an hour', () => {
      let now = 0;
      const jobs = new BakeJobs(() => now);
      const done = jobs.create({ results: [], mapErrors: [], missingRooms: [] });
      const running = jobs.create({ results: [], mapErrors: [], missingRooms: [] });
      jobs.finish(done);
      now = 60 * 60 * 1000 - 1;
      expect(jobs.get(done.id)).toBe(done);
      now += 1;
      expect(jobs.get(done.id)).toBeUndefined();
      expect(jobs.get(running.id)).toBe(running);
    });
  });

  it('rejects a bake while another heavy operation is running and frees the lock afterwards', async () => {
    const started = deferred();
    const gate = deferred();
    const catalog: CatalogStorage = {
      load: async () => {
        started.resolve();
        await gate.promise;
        return null;
      },
      save: async () => {},
    };
    const { docs, call } = await connect({ catalog });
    await docs.layouts.save('hall', {
      ...emptyLayoutDocument('hall'),
      commands: [{ op: 'placeObject', id: 'p1', kindId: 'colored_block_blue', position: [0, 0, 0] }],
    } as LayoutDocument);

    const first = call('bake_layout', { name: 'hall' });
    await started.promise;
    expect(await call('bake_layout', { name: 'hall' })).toEqual({
      isError: true,
      text: 'a bake or render is already in progress; retry shortly',
    });
    gate.resolve();
    await first;
    expect((await call('bake_layout', { name: 'hall' })).text).not.toContain('already in progress');
  });

  describe('render_view', () => {
    const hall = { type: 'room', name: 'hall' };

    async function connectWithRoom(renderer: FakeRenderer = new FakeRenderer()) {
      const connected = await connect({}, renderer);
      await connected.docs.rooms.save('hall', emptyRoomDocument('hall'));
      const render = (args: Record<string, unknown>) => connected.client.callTool({ name: 'render_view', arguments: args });
      return { ...connected, renderer, render };
    }

    it('returns the PNG and a text block with the target, camera and bounds', async () => {
      const { render, renderer } = await connectWithRoom();
      const camera = { position: [4, 6, 8], lookAt: [0, 0, 0] };
      const result = await render({ target: hall, camera, width: 320 });

      expect(result.isError).toBeFalsy();
      const [image, text] = result.content as { type: string; data?: string; mimeType?: string; text?: string }[];
      expect(image).toEqual({ type: 'image', mimeType: 'image/png', data: Buffer.from(PNG_BYTES).toString('base64') });
      expect(JSON.parse(text.text!)).toMatchObject({
        target: hall,
        camera,
        width: 320,
        height: 768,
        bounds: { min: [0, 0, 0], max: [4, 2, 4] },
        metresPerPixel: 0.02,
      });
      expect(renderer.requests).toEqual([
        {
          origin: 'http://studio.test',
          request: { target: hall, camera: { type: 'custom', ...camera }, width: 320, height: 768 },
        },
      ]);
    });

    it('reports a missing document without starting the renderer', async () => {
      const { render, renderer } = await connectWithRoom();
      const result = await render({ target: { type: 'map', name: 'nowhere' }, camera: 'top' });
      expect(result).toMatchObject({ isError: true, content: [{ text: 'map "nowhere" not found' }] });
      expect(renderer.requests).toEqual([]);
    });

    it.each([
      ['a width over the cap', { camera: 'top', width: 2048 }],
      ['a fractional height', { camera: 'top', height: 100.5 }],
      ['an unknown camera', { camera: 'side' }],
      ['a camera looking at itself', { camera: { position: [1, 2, 3], lookAt: [1, 2, 3] } }],
      ['a non-finite camera coordinate', { camera: { position: [1, 2, null], lookAt: [0, 0, 0] } }],
      ['an unexpected camera key', { camera: { position: [1, 2, 3], lookAt: [0, 0, 0], fov: 90 } }],
    ])('rejects %s', async (_label, args) => {
      const { render, renderer } = await connectWithRoom();
      expect((await render({ target: hall, ...args })).isError).toBe(true);
      expect(renderer.requests).toEqual([]);
    });

    it('rejects an invalid target name', async () => {
      const { render, renderer } = await connectWithRoom();
      expect((await render({ target: { type: 'room', name: '../evil' }, camera: 'iso' })).isError).toBe(true);
      expect(renderer.requests).toEqual([]);
    });

    it('surfaces a renderer error as a tool error and frees the lock', async () => {
      const { render, renderer } = await connectWithRoom();
      const message = 'render failed: ghost-layout has no baked GLB';
      renderer.render = async () => {
        throw new Error(message);
      };
      expect(await render({ target: hall, camera: 'iso' })).toMatchObject({ isError: true, content: [{ text: message }] });
      renderer.render = async () => ({ png: PNG_BYTES, bounds: { min: [0], max: [1] } });
      expect((await render({ target: hall, camera: 'iso' })).isError).toBeFalsy();
    });

    it('passes the top and iso cameras as their own variants', async () => {
      const { render, renderer } = await connectWithRoom();
      await render({ target: hall, camera: 'top' });
      await render({ target: hall, camera: 'iso' });
      expect(renderer.requests.map(({ request }) => request.camera)).toEqual([{ type: 'top' }, { type: 'iso' }]);
    });

    it('never overlaps a bake and a render, in either order', async () => {
      const gate = deferred();
      const renderEntered = deferred();
      const bakeEntered = deferred();
      const renderer = new FakeRenderer();
      const { docs, call, render } = await connectWithRoom(renderer);
      const busy = { isError: true, text: 'a bake or render is already in progress; retry shortly' };

      renderer.render = async () => {
        renderEntered.resolve();
        await gate.promise;
        return { png: PNG_BYTES, bounds: { min: [0], max: [1] } } satisfies RenderResult;
      };
      const rendering = render({ target: hall, camera: 'iso' });
      await renderEntered.promise;
      expect(await call('bake_layout', { name: 'hall' })).toEqual(busy);
      gate.resolve();
      await rendering;

      const bakeGate = deferred();
      await docs.layouts.save('hall', {
        ...emptyLayoutDocument('hall'),
        commands: [{ op: 'placeObject', id: 'p1', kindId: 'colored_block_blue', position: [0, 0, 0] }],
      } as LayoutDocument);
      docs.catalog.load = async () => {
        bakeEntered.resolve();
        await bakeGate.promise;
        return null;
      };
      const baking = call('bake_layout', { name: 'hall' });
      await bakeEntered.promise;
      const refused = await render({ target: hall, camera: 'iso' });
      expect(refused).toMatchObject({ isError: true, content: [{ text: busy.text }] });
      bakeGate.resolve();
      await baking;
    });
  });
});
