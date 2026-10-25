import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { emptyMapDocument, emptyRoomDocument } from '@officexr/world/scenes';
import studioStorage from '@officexr/world/vite-plugin-storage';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import studioMcp from './vite-plugin.ts';

let dataDir: string;
let vite: ViteDevServer;
let url: string;

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'studio-mcp-'));
  vite = await createServer({
    configFile: false,
    logLevel: 'silent',
    plugins: [studioStorage({ dataDir }), studioMcp()],
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

    expect((await client.listTools()).tools).toHaveLength(16);
    expect((await call('put_room', { name: 'hall', room: emptyRoomDocument('hall') })).isError).toBe(false);
    const map = { ...emptyMapDocument('town'), rooms: [{ id: 'a', roomName: 'hall', position: [0, 0, 0] }] };
    expect((await call('put_map', { name: 'town', map })).isError).toBe(false);
    expect(JSON.parse((await call('get_map', { name: 'town' })).text).name).toBe('town');

    const bad = await call('put_room', { name: 'bad', room: { nope: true } });
    expect(bad.isError).toBe(true);
    expect((await call('put_layout', { name: 'bad', layout: { nope: true } })).isError).toBe(true);
    expect((await call('put_room', { name: '../evil', room: emptyRoomDocument('x') })).isError).toBe(true);
    expect(await readdir(path.join(dataDir, 'rooms'))).toEqual(['hall.json']);
    expect(await readdir(dataDir)).not.toContain('layouts');
    await client.close();
  });

  it('answers GET and DELETE with 405', async () => {
    expect((await fetch(url)).status).toBe(405);
    expect((await fetch(url, { method: 'DELETE' })).status).toBe(405);
  });
});
