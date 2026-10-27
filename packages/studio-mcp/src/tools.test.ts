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
import { describe, expect, it } from 'vitest';
import { HeavyWorkLock } from './heavy-work-lock.ts';
import type { RenderRequest, RenderResult, ViewRenderer } from './renderer.ts';
import { createStudioMcpServer } from './server.ts';
import type { StudioDocuments } from './studio-documents.ts';

class InMemoryCatalogStorage implements CatalogStorage {
  saved = 0;
  constructor(private readonly catalog: WorldObjectKindCatalogV1 | null = null) {}
  async load() {
    return this.catalog;
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

async function connect(overrides: Partial<StudioDocuments> = {}, renderer: ViewRenderer = new FakeRenderer()) {
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
  const options = { modelRoot: '/nonexistent', heavyWorkLock: new HeavyWorkLock('a bake or render'), renderer };
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
  it('lists the 20 tools', async () => {
    const { client } = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        ...['room', 'map', 'layout'].flatMap((n) => [`list_${n}s`, `get_${n}`, `put_${n}`, `delete_${n}`]),
        'bake_layout',
        'list_baked_layouts',
        'delete_baked_layout',
        'render_view',
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
