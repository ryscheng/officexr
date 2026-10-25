import { request } from 'node:http';
import { access, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { emptyLayoutDocument, emptyMapDocument, emptyRoomDocument } from '@officexr/world/scenes';
import studioStorage from '@officexr/world/vite-plugin-storage';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import studioMcp from './vite-plugin.ts';

let dataDir: string;
let vite: ViteDevServer;
let url: string;
const saved: string[] = [];
const deleted: string[] = [];
const modelRoot = fileURLToPath(new URL('../../studio/public', import.meta.url));
const hasModels = await access(path.join(modelRoot, 'models/blocks')).then(() => true, () => false);

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'studio-mcp-'));
  vite = await createServer({
    configFile: false,
    logLevel: 'silent',
    plugins: [
      studioStorage({
        dataDir,
        bakedLayouts: {
          onSaved: async (name) => void saved.push(name),
          onDeleted: async (name) => void deleted.push(name),
        },
      }),
      studioMcp({ modelRoot }),
    ],
    server: { port: 0, host: '127.0.0.1' },
  });
  await vite.listen();
  url = `http://127.0.0.1:${(vite.httpServer!.address() as { port: number }).port}/mcp`;
});

afterAll(async () => {
  await vite.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe('POST /mcp over HTTP', () => {
  it('writes through the REST surface and rejects what it rejects', async () => {
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    const call = async (name: string, args: Record<string, unknown>) => {
      const r = await client.callTool({ name, arguments: args });
      return { isError: r.isError === true, text: (r.content as { text: string }[])[0].text };
    };

    expect((await client.listTools()).tools).toHaveLength(19);
    expect((await call('put_room', { name: 'hall', room: emptyRoomDocument('hall') })).isError).toBe(false);
    const map = { ...emptyMapDocument('town'), rooms: [{ id: 'a', roomName: 'hall', position: [0, 0, 0] }] };
    expect((await call('put_map', { name: 'town', map })).isError).toBe(false);
    expect(JSON.parse((await call('get_map', { name: 'town' })).text).name).toBe('town');

    const bad = await call('put_room', { name: 'bad', room: { nope: true } });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain('room-storage save: 400');
    expect(bad.text).toContain('missing string `name`');
    expect((await call('put_layout', { name: 'bad', layout: { nope: true } })).isError).toBe(true);
    expect((await call('put_room', { name: '../evil', room: emptyRoomDocument('x') })).isError).toBe(true);
    expect(await readdir(path.join(dataDir, 'rooms'))).toEqual(['hall.json']);
    expect(await readdir(dataDir)).not.toContain('layouts');
    await client.close();
  });

  it('rejects a foreign Host header', async () => {
    const { port } = vite.httpServer!.address() as { port: number };
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(
        { port, host: '127.0.0.1', path: '/mcp', method: 'POST', headers: { host: 'evil.example:5174' } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on('error', reject);
      req.end('{}');
    });
    expect(status).toBe(403);
  });

  it('answers GET and DELETE with 405', async () => {
    expect((await fetch(url)).status).toBe(405);
    expect((await fetch(url, { method: 'DELETE' })).status).toBe(405);
  });

  it.skipIf(!hasModels)('bakes, lists and deletes a layout through the storage hooks', async () => {
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await client.callTool({ name, arguments: args });
      return { isError: r.isError === true, text: (r.content as { text: string }[])[0].text };
    };
    const layout = {
      ...emptyLayoutDocument('hall'),
      commands: [{ id: 'p1', op: 'placeObject', kindId: 'colored_block_blue', position: [0, 0, 0] }],
    };
    await call('put_layout', { name: 'hall', layout });

    const baked = JSON.parse((await call('bake_layout', { name: 'hall' })).text);
    expect(baked).toMatchObject({ name: 'hall', optimizer: expect.any(String) });
    const [listed] = JSON.parse((await call('list_baked_layouts')).text);
    expect(listed).toMatchObject({ name: 'hall', size: baked.bytes });
    expect(saved).toEqual(['hall']);

    expect((await call('delete_baked_layout', { name: 'hall' })).isError).toBe(false);
    expect(deleted).toEqual(['hall']);
    expect(JSON.parse((await call('list_baked_layouts')).text)).toEqual([]);
    await client.close();
  });
});
