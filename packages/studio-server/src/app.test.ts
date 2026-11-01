import { createServer, type Server } from 'node:http';
import { connect as netConnect } from 'node:net';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { DEFAULT_WORLD_CONSTANTS } from '@officexr/sdk';
import { createStudioMcpOptions, loopbackOrigin } from '@officexr/studio-mcp/mount-mcp';
import { createStudioStorage } from '@officexr/world/vite-plugin-storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { createInternalServer, createPublicServer, type StudioListener } from './app.ts';

const DOWN = 'http://127.0.0.1:1';

let dir: string;
let saves: number;
const listeners: StudioListener[] = [];

const listen = async (server: Server) => {
  listeners.push({ server, close: () => new Promise((r) => server.close(() => r())) });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return loopbackOrigin(server);
};

async function boot(realtimeTarget = DOWN) {
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
  const internal = createInternalServer({
    storage,
    modelsDir,
    studioDist: path.join(dir, 'dist'),
    mcp: createStudioMcpOptions({ modelRoot: dir }),
    realtimeTarget,
  });
  const pub = createPublicServer({ storage, modelsDir, realtimeTarget });
  listeners.push(internal, pub);
  for (const { server } of [internal, pub]) {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  }
  return { internal: loopbackOrigin(internal.server), pub: loopbackOrigin(pub.server), pubListener: pub };
}

/** A realtime stand-in: `/health` answers, `/ws` echoes. */
async function realtimeStub() {
  const server = createServer((req, res) => res.end(`up ${req.url}`));
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (socket) => socket.on('message', (data) => socket.send(`echo ${data}`)));
  listeners.push({
    server,
    close: () => {
      for (const client of wss.clients) {
        client.terminate();
      }
      return new Promise((r) => wss.close(() => server.close(() => r())));
    },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return loopbackOrigin(server);
}

async function openWs(origin: string) {
  const ws = new WebSocket(`${origin.replace('http', 'ws')}/ws`);
  await new Promise((resolve, reject) => ws.once('open', resolve).once('error', reject));
  return ws;
}

/** Resolves once the server ends the socket of a raw upgrade request to `urlPath`. */
function rawUpgradeEnds(origin: string, urlPath: string) {
  const { port } = new URL(origin);
  const socket = netConnect(Number(port), '127.0.0.1', () => {
    socket.write(`GET ${urlPath} HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`);
  });
  socket.on('error', () => {});
  socket.resume();
  return new Promise<void>((resolve) => socket.once('close', () => resolve()));
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
  for (const listener of listeners.splice(0)) {
    listener.server.closeAllConnections();
    await listener.close();
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
    for (const index of ['/?op=render', '/index.html']) {
      const spa = await fetch(`${internal}${index}`);
      expect(spa.headers.get('content-type')).toMatch(/^text\/html/);
      expect(spa.headers.get('cache-control')).toBe('no-cache');
      expect(await spa.text()).toBe('<html>studio</html>');
    }
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
});

describe.each(['internal', 'pub'] as const)('realtime proxy on the %s port', (port) => {
  it('proxies /health, answering 502 while the realtime server is down', async () => {
    expect((await fetch(`${(await boot())[port]}/health`)).status).toBe(502);
    const origins = await boot(await realtimeStub());
    expect(await (await fetch(`${origins[port]}/health`)).text()).toBe('up /health');
  });

  it('proxies /ws upgrades to the realtime server', async () => {
    const ws = await openWs((await boot(await realtimeStub()))[port]);
    ws.send('hi');
    const reply = await new Promise((resolve) => ws.once('message', (data) => resolve(String(data))));
    ws.close();
    expect(reply).toBe('echo hi');
  });

  it('drops a /ws upgrade while the realtime server is down, and other upgrades always', async () => {
    const origins = await boot();
    await rawUpgradeEnds(origins[port], '/ws');
    const origin = (await boot(await realtimeStub()))[port];
    await rawUpgradeEnds(origin, '/elsewhere');
    expect((await fetch(`${origin}/health`)).status).toBe(200);
  });
});

it('survives a client resetting an upgrade the realtime server has not answered yet', async () => {
  const stalling = createServer((_req, res) => res.end('up'));
  const held: Duplex[] = [];
  stalling.on('upgrade', (_req, socket: Duplex) => held.push(socket));
  const { pub } = await boot(await listen(stalling));
  const socket = netConnect(Number(new URL(pub).port), '127.0.0.1', () => {
    socket.write('GET /ws HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
  });
  await expect.poll(() => held.length).toBe(1);
  socket.resetAndDestroy();
  await new Promise((r) => setTimeout(r, 50));
  expect((await fetch(`${pub}/health`)).status).toBe(200);
  held[0].destroy();
});

it('close() resolves while a proxied WebSocket is open', async () => {
  const { pub, pubListener } = await boot(await realtimeStub());
  const ws = await openWs(pub);
  const wsClosed = new Promise((r) => ws.once('close', r));
  await pubListener.close();
  await wsClosed;
});

it('serves one storage on both ports, firing a save hook once per write', async () => {
  const { internal, pub } = await boot();
  const res = await fetch(`${pub}/api/world-settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(DEFAULT_WORLD_CONSTANTS),
  });
  expect(res.status).toBe(204);
  expect(await (await fetch(`${internal}/api/world-settings`)).json()).toEqual(DEFAULT_WORLD_CONSTANTS);
  expect(saves).toBe(1);
});
