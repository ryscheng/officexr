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
} from '@officexr/world/scenes';
import { describe, expect, it } from 'vitest';
import { createStudioMcpServer } from './server.ts';
import type { StudioDocuments } from './studio-documents.ts';

class InMemoryCatalogStorage implements CatalogStorage {
  saved = 0;
  async load() {
    return null;
  }
  async save() {
    this.saved += 1;
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
  async delete(name: string) {
    this.files.delete(name);
  }
}

async function connect(overrides: Partial<StudioDocuments> = {}) {
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
  await createStudioMcpServer(docs, { modelRoot: '/nonexistent', bakeLock: { busy: false } }).connect(serverSide);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { isError: r.isError === true, text: (r.content as { text: string }[])[0].text };
  };
  return { docs, client, call };
}

describe('studio MCP tools', () => {
  it('lists the 19 tools', async () => {
    const { client } = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        ...['room', 'map', 'layout'].flatMap((n) => [`list_${n}s`, `get_${n}`, `put_${n}`, `delete_${n}`]),
        'bake_layout',
        'list_baked_layouts',
        'delete_baked_layout',
        'get_world_object_kinds',
        'put_world_object_kinds',
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

  it('rejects a bake while another is running and frees the lock afterwards', async () => {
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((r) => (entered = r));
    const gate = new Promise<void>((r) => (release = r));
    const catalog: CatalogStorage = {
      load: async () => {
        entered();
        await gate;
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
    await started;
    expect(await call('bake_layout', { name: 'hall' })).toEqual({
      isError: true,
      text: 'a bake is already in progress; retry shortly',
    });
    release();
    await first;
    expect((await call('bake_layout', { name: 'hall' })).text).not.toContain('already in progress');
  });
});
