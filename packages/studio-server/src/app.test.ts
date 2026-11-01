import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_WORLD_CONSTANTS } from '@officexr/sdk';
import { createStudioMcpOptions } from '@officexr/studio-mcp/mount-mcp';
import { createStudioStorage } from '@officexr/world/vite-plugin-storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { createInternalServer, createPublicServer } from './app.ts';

let dir: string;
let saves: number;
const servers: Server[] = [];

const listen = async (server: Server) => {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

async function boot(realtimeTarget = 'http://127.0.0.1:1') {
  const storage = createStudioStorage({
    dataDir: path.join(dir, 'data'),
    worldSettings: {
      onSaved: async () => {
        saves++;
        return [];
      },
    },
  });
  const modelsDir = path.join(dir, 'models');
  const internal = await listen(
    createInternalServer({
      storage,
      modelsDir,
      studioDist: path.join(dir, 'dist'),
      mcp: createStudioMcpOptions({ modelRoot: dir }),
    }),
  );
  const pub = await listen(createPublicServer({ storage, modelsDir, realtimeTarget }));
  return { internal, pub };
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'studio-server-'));
  saves = 0;
  await mkdir(path.join(dir, 'models'));
  await writeFile(path.join(dir, 'models', 'chair.glb'), 'glb');
  await mkdir(path.join(dir, 'dist'));
  await writeFile(path.join(dir, 'dist', 'index.html'), '<html>studio</html>');
  await writeFile(path.join(dir, 'dist', 'app.js'), 'export {};');
});

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
  await rm(dir, { recursive: true, force: true });
});

describe('internal server', () => {
  it('serves /mcp and the SPA', async () => {
    const { internal } = await boot();
    const mcp = await fetch(`${internal}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(mcp.status).toBe(200);
    expect((await mcp.json()).result.tools.length).toBeGreaterThan(0);
    const spa = await fetch(`${internal}/?op=render`);
    expect(spa.headers.get('content-type')).toMatch(/^text\/html/);
    expect(await spa.text()).toBe('<html>studio</html>');
    expect((await fetch(`${internal}/app.js`)).headers.get('content-type')).toBe('text/javascript');
  });
});

describe('public server', () => {
  it('serves /models but not /mcp or the SPA', async () => {
    const { pub } = await boot();
    expect(await (await fetch(`${pub}/models/chair.glb`)).text()).toBe('glb');
    expect((await fetch(`${pub}/mcp`, { method: 'POST' })).status).toBe(404);
    expect((await fetch(`${pub}/`)).status).toBe(404);
  });

  it('proxies /health, answering 502 while the realtime server is down', async () => {
    expect((await fetch(`${(await boot()).pub}/health`)).status).toBe(502);
    const target = await listen(createServer((req, res) => res.end(`up ${req.url}`)));
    expect(await (await fetch(`${(await boot(target)).pub}/health`)).text()).toBe('up /health');
  });

  it('proxies /ws upgrades to the realtime server', async () => {
    const target = createServer();
    const wss = new WebSocketServer({ server: target, path: '/ws' });
    wss.on('connection', (socket) => socket.on('message', (data) => socket.send(`echo ${data}`)));
    const { pub } = await boot(await listen(target));
    const ws = new WebSocket(`${pub.replace('http', 'ws')}/ws`);
    await new Promise((resolve, reject) => ws.once('open', resolve).once('error', reject));
    ws.send('hi');
    const reply = await new Promise((resolve) => ws.once('message', (data) => resolve(String(data))));
    ws.close();
    wss.close();
    expect(reply).toBe('echo hi');
  });
});

describe('shared storage', () => {
  it.each(['internal', 'pub'] as const)('fires onSaved once for a PUT on the %s port', async (port) => {
    const origins = await boot();
    const res = await fetch(`${origins[port]}/api/world-settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(DEFAULT_WORLD_CONSTANTS),
    });
    expect(res.status).toBe(204);
    expect(saves).toBe(1);
  });
});
