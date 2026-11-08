import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { emptyRoomDocument } from '@officexr/world/scenes';
import { createStudioStorage } from '@officexr/world/vite-plugin-storage';
import { afterEach, describe, expect, it } from 'vitest';
import { mountMcp, type McpApp } from './mount-mcp.ts';
import { HeavyWorkLock } from './heavy-work-lock.ts';
import { BakeJobs } from './tools/bake-jobs.ts';

let server: Server | undefined;
afterEach(async () => {
  await new Promise((r) => (server ? server.close(r) : r(undefined)));
  server = undefined;
});

function plainApp() {
  const mounts: Array<[string, Parameters<McpApp['use']>[1]]> = [];
  const app: McpApp = { use: (path, handler) => mounts.push([path, handler]) };
  return { app, mounts };
}

const options = (origin: () => string) => ({
  origin,
  modelRoot: '/nowhere',
  heavyWorkLock: new HeavyWorkLock('test'),
  renderer: { render: async () => ({}) as never },
  bakeJobs: new BakeJobs(),
});

describe('mountMcp', () => {
  it('guards and handles /mcp on a plain app, answering GET with 405', async () => {
    const { app, mounts } = plainApp();
    mountMcp(app, options(() => 'http://127.0.0.1:1'));
    expect(mounts).toHaveLength(1);
    server = createServer((req, res) => {
      req.url = req.url!.replace(/^\/mcp/, '') || '/';
      void mounts[0][1](req, res, () => {});
    });
    await new Promise<void>((r) => server!.listen(0, r));
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('talks to storage at the injected origin', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mount-mcp-'));
    const storage = plainApp();
    createStudioStorage({ dataDir: dir }).mount(storage.app);
    const storageServer = createServer((req, res) => {
      const mount = storage.mounts.find(([base]) => req.url?.startsWith(base))!;
      req.url = req.url!.slice(mount[0].length) || '/';
      void mount[1](req, res, () => {});
    });
    await new Promise<void>((r) => storageServer.listen(0, r));
    const origin = `http://127.0.0.1:${(storageServer.address() as AddressInfo).port}`;
    const { app, mounts } = plainApp();
    mountMcp(app, options(() => origin));
    server = createServer((req, res) => void mounts[0][1](req, res, () => {}));
    await new Promise<void>((r) => server!.listen(0, r));
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`)),
    );
    try {
      await client.callTool({ name: 'put_room', arguments: { name: 'hall', room: emptyRoomDocument('hall') } });
      expect(await readdir(path.join(dir, 'rooms'))).toEqual(['hall.json']);
    } finally {
      await client.close();
      await new Promise((r) => storageServer.close(r));
      await rm(dir, { recursive: true, force: true });
    }
  });
});
