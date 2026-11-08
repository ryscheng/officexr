import { createServer, type Server } from 'node:http';
import { connect as netConnect } from 'node:net';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import type { NextHandleFunction } from 'connect';
import session from 'express-session';
import { DEFAULT_WORLD_CONSTANTS } from '@officexr/sdk';
import { createSessionReader } from '@officexr/server';
import { createStudioMcpOptions, loopbackOrigin } from '@officexr/studio-mcp/mount-mcp';
import { createStudioStorage } from '@officexr/world/vite-plugin-storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { createInternalServer, createPublicServer, type StudioListener } from './app.ts';
import { createOAuthApp } from './oauth/index.ts';
import { InMemoryOAuthStore } from './oauth/store.ts';
import { cacheAllowlist, type IsAllowed } from './studio-gate.ts';
import { signIn as signInAs } from './test-sign-in.ts';

const DOWN = 'http://127.0.0.1:1';
const SECRET = 'test-secret';
const FRONTEND = 'https://studio.example.com';
const ALLOWED = 'allowed@example.com';

let sessionStore: session.MemoryStore;
let isStudioAllowed: IsAllowed;

const signIn = (login: string) => signInAs(sessionStore, SECRET, login);

let dir: string;
let saves: number;
const listeners: StudioListener[] = [];

const listen = async (server: Server) => {
  listeners.push({ server, close: () => new Promise((r) => server.close(() => r())) });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return loopbackOrigin(server);
};

async function boot(realtimeTarget = DOWN, oauth?: NextHandleFunction) {
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
  const uploadedModelsDir = path.join(dir, 'uploaded');
  const internal = createInternalServer({
    storage,
    modelsDir,
    uploadedModelsDir,
    studioDist: path.join(dir, 'dist'),
    mcp: createStudioMcpOptions({ modelRoot: dir }),
    realtimeTarget,
  });
  const pub = createPublicServer({
    storage,
    modelsDir,
    uploadedModelsDir,
    realtimeTarget,
    frontendOrigins: [FRONTEND],
    sessionReader: createSessionReader({ sessionSecret: SECRET, sessionStore, secure: false }),
    isStudioAllowed: (login) => isStudioAllowed(login),
    oauth,
  });
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

async function openWs(origin: string, cookie?: string, pageOrigin?: string) {
  const ws = new WebSocket(`${origin.replace('http', 'ws')}/ws`, { headers: cookie ? { cookie } : {}, origin: pageOrigin });
  await new Promise((resolve, reject) => ws.once('open', resolve).once('error', reject));
  return ws;
}

function rawUpgrade(origin: string, urlPath: string, cookie?: string, pageOrigin?: string) {
  const socket = netConnect(Number(new URL(origin).port), '127.0.0.1', () => {
    const cookieHeader = cookie ? `Cookie: ${cookie}\r\n` : '';
    const originHeader = pageOrigin ? `Origin: ${pageOrigin}\r\n` : '';
    socket.write(`GET ${urlPath} HTTP/1.1\r\nHost: x\r\n${cookieHeader}${originHeader}Connection: Upgrade\r\nUpgrade: websocket\r\n\r\n`);
  });
  return socket;
}

/** Resolves with everything the server sent once it ends the socket of a raw upgrade request to `urlPath`. */
function rawUpgradeEnds(origin: string, urlPath: string, cookie?: string, pageOrigin?: string) {
  const socket = rawUpgrade(origin, urlPath, cookie, pageOrigin);
  let received = '';
  socket.on('error', () => {});
  socket.on('data', (chunk) => (received += chunk));
  return new Promise<string>((resolve) => socket.once('close', () => resolve(received)));
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'studio-server-'));
  saves = 0;
  sessionStore = new session.MemoryStore();
  isStudioAllowed = async (login) => login === ALLOWED;
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
  it('serves /api, /mcp and the SPA without a session', async () => {
    const { internal } = await boot();
    expect((await fetch(`${internal}/api/maps`)).status).toBe(200);
    const mcp = await fetch(`${internal}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(mcp.status).toBe(200);
    expect((await mcp.json()).result.tools.length).toBeGreaterThan(0);
    for (const index of ['/studio/?op=render', '/studio/index.html']) {
      const spa = await fetch(`${internal}${index}`);
      expect(spa.headers.get('content-type')).toMatch(/^text\/html/);
      expect(spa.headers.get('cache-control')).toBe('no-cache');
      expect(await spa.text()).toBe('<html>studio</html>');
    }
    for (const from of ['/', '/studio']) {
      const redirect = await fetch(`${internal}${from}`, { redirect: 'manual' });
      expect(redirect.status).toBe(302);
      expect(redirect.headers.get('location')).toBe('/studio/');
    }
    expect((await fetch(`${internal}/studio/app.js`)).headers.get('content-type')).toBe('text/javascript');
  });
});

describe.each(['internal', 'pub'] as const)('/models on the %s port', (port) => {
  it('serves uploaded files first, then bundled ones, else 404', async () => {
    const booted = await boot();
    await mkdir(path.join(dir, 'uploaded', 'pack'), { recursive: true });
    await writeFile(path.join(dir, 'uploaded', 'pack', 'a.glb'), 'uploaded');
    await writeFile(path.join(dir, 'uploaded', 'chair.glb'), 'uploaded-chair');
    await writeFile(path.join(dir, 'models', 'bundled-only.glb'), 'bundled');
    const base = booted[port];
    const headers = port === 'pub' ? { cookie: await signIn(ALLOWED) } : undefined;
    const text = async (rel: string) => {
      const res = await fetch(`${base}/models/${rel}`, { headers });
      return res.status === 200 ? res.text() : res.status;
    };
    expect(await text('pack/a.glb')).toBe('uploaded');
    expect(await text('chair.glb')).toBe('uploaded-chair');
    expect(await text('bundled-only.glb')).toBe('bundled');
    expect(await text('missing.glb')).toBe(404);
  });
});

describe('public server', () => {
  it('serves /models but not /mcp or the SPA', async () => {
    const { pub } = await boot();
    const headers = { cookie: await signIn(ALLOWED) };
    expect(await (await fetch(`${pub}/models/chair.glb`, { headers })).text()).toBe('glb');
    expect((await fetch(`${pub}/mcp`, { method: 'POST', headers })).status).toBe(404);
    expect((await fetch(`${pub}/`, { headers })).status).toBe(404);
  });

  it('answers 401 without a session', async () => {
    const { pub } = await boot();
    for (const urlPath of ['/api/maps', '/api/me', '/models/chair.glb', '/health']) {
      const res = await fetch(`${pub}${urlPath}`);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Not signed in' });
    }
  });

  it('serves no OAuth routes unless the OAuth app is mounted', async () => {
    const { pub } = await boot();
    expect((await fetch(`${pub}/.well-known/oauth-authorization-server`)).status).toBe(401);
  });

  it('serves the OAuth routes without a session, passing every other path on to the gate', async () => {
    const oauth = createOAuthApp({
      store: new InMemoryOAuthStore(),
      isAdmin: async () => true,
      issuerUrl: 'https://studio-api.example.com',
      webPublicUrl: 'https://web.example.com',
    });
    const { pub } = await boot(DOWN, oauth.handler);
    const metadata = await fetch(`${pub}/.well-known/oauth-authorization-server`);
    expect(metadata.status).toBe(200);
    expect((await metadata.json()).issuer).toBe('https://studio-api.example.com/');
    expect((await fetch(`${pub}/api/maps`)).status).toBe(401);
    const res = await fetch(`${pub}/api/me`, { headers: { cookie: await signIn(ALLOWED) } });
    expect(await res.json()).toEqual({ login: ALLOWED, name: ALLOWED });
    expect(res.headers.get('x-powered-by')).toBeNull();
  });

  it('answers 403 for a signed-in login not on the studio allowlist', async () => {
    const { pub } = await boot();
    const headers = { cookie: await signIn('other@example.com') };
    for (const urlPath of ['/api/maps', '/api/me']) {
      const res = await fetch(`${pub}${urlPath}`, { headers });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'Not allowed' });
    }
  });

  it('serves an allowed login, with its identity at /api/me', async () => {
    const { pub } = await boot();
    const headers = { cookie: await signIn(ALLOWED), origin: FRONTEND };
    const me = await fetch(`${pub}/api/me`, { headers });
    expect(me.status).toBe(200);
    expect(me.headers.get('access-control-allow-origin')).toBe(FRONTEND);
    expect(me.headers.get('access-control-allow-credentials')).toBe('true');
    expect(await me.json()).toEqual({ login: ALLOWED, name: ALLOWED });
    expect((await fetch(`${pub}/api/maps`, { headers })).status).toBe(200);
  });

  it('answers a frontend preflight before the gate', async () => {
    const { pub } = await boot();
    const res = await fetch(`${pub}/api/maps`, {
      method: 'OPTIONS',
      headers: { origin: FRONTEND, 'access-control-request-method': 'PUT', 'access-control-request-headers': 'content-type' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(FRONTEND);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('answers a 500 without the error details when the allowlist lookup fails', async () => {
    const { pub } = await boot();
    isStudioAllowed = async () => {
      throw new Error('db down');
    };
    const res = await fetch(`${pub}/api/me`, { headers: { cookie: await signIn(ALLOWED) } });
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(JSON.stringify({ error: 'Internal error' }));
  });

  it('proxies /ws for an allowed session from a frontend origin or with no Origin', async () => {
    const realtime = await realtimeStub();
    const { pub } = await boot(realtime);
    for (const pageOrigin of [FRONTEND, undefined]) {
      const ws = await openWs(pub, await signIn(ALLOWED), pageOrigin);
      ws.send('hi');
      expect(await new Promise((resolve) => ws.once('message', (data) => resolve(String(data))))).toBe('echo hi');
      ws.close();
    }
  });

  it('refuses /ws upgrades without an allowed session, never reaching the realtime server', async () => {
    let upgrades = 0;
    const realtime = createServer();
    realtime.on('upgrade', (_req, socket: Duplex) => {
      upgrades++;
      socket.destroy();
    });
    const { pub } = await boot(await listen(realtime));
    expect(await rawUpgradeEnds(pub, '/ws')).toMatch(/^HTTP\/1\.1 401 /);
    expect(await rawUpgradeEnds(pub, '/ws', await signIn('other@example.com'))).toMatch(/^HTTP\/1\.1 403 /);
    expect(await rawUpgradeEnds(pub, '/ws', await signIn(ALLOWED), 'https://evil.example.com')).toMatch(/^HTTP\/1\.1 403 /);
    isStudioAllowed = async () => {
      throw new Error('db down');
    };
    expect(await rawUpgradeEnds(pub, '/ws', await signIn(ALLOWED))).toMatch(/^HTTP\/1\.1 500 /);
    expect(upgrades).toBe(0);
  });
});

describe('cacheAllowlist', () => {
  it('reuses an answer for the ttl and does not remember failures', async () => {
    let clock = 0;
    let lookups = 0;
    let fail = true;
    const cached = cacheAllowlist(
      async () => {
        lookups++;
        if (fail) {
          throw new Error('db down');
        }
        return true;
      },
      1000,
      () => clock,
    );
    await expect(cached(ALLOWED)).rejects.toThrow('db down');
    fail = false;
    expect(await cached(ALLOWED)).toBe(true);
    clock = 999;
    expect(await cached(ALLOWED)).toBe(true);
    expect(lookups).toBe(2);
    clock = 1000;
    expect(await cached(ALLOWED)).toBe(true);
    expect(lookups).toBe(3);
  });
});

describe.each(['internal', 'pub'] as const)('realtime proxy on the %s port', (port) => {
  // The internal port ignores the session cookie; the public one requires it.
  const cookie = () => signIn(ALLOWED);

  it('proxies /health, answering 502 while the realtime server is down', async () => {
    const headers = { cookie: await cookie() };
    expect((await fetch(`${(await boot())[port]}/health`, { headers })).status).toBe(502);
    const origins = await boot(await realtimeStub());
    expect(await (await fetch(`${origins[port]}/health`, { headers })).text()).toBe('up /health');
  });

  it('proxies /ws upgrades to the realtime server', async () => {
    const ws = await openWs((await boot(await realtimeStub()))[port], await cookie());
    ws.send('hi');
    const reply = await new Promise((resolve) => ws.once('message', (data) => resolve(String(data))));
    ws.close();
    expect(reply).toBe('echo hi');
  });

  it('drops a /ws upgrade while the realtime server is down, and other upgrades always', async () => {
    const allowed = await cookie();
    const origins = await boot();
    await rawUpgradeEnds(origins[port], '/ws', allowed);
    const origin = (await boot(await realtimeStub()))[port];
    await rawUpgradeEnds(origin, '/elsewhere', allowed);
    expect((await fetch(`${origin}/health`, { headers: { cookie: allowed } })).status).toBe(200);
  });
});

it('survives a client resetting an upgrade the realtime server has not answered yet', async () => {
  const stalling = createServer((_req, res) => res.end('up'));
  const held: Duplex[] = [];
  stalling.on('upgrade', (_req, socket: Duplex) => held.push(socket));
  const { pub } = await boot(await listen(stalling));
  const cookie = await signIn(ALLOWED);
  const socket = rawUpgrade(pub, '/ws', cookie);
  await expect.poll(() => held.length).toBe(1);
  socket.resetAndDestroy();
  await new Promise((r) => setTimeout(r, 50));
  expect((await fetch(`${pub}/health`, { headers: { cookie } })).status).toBe(200);
  held[0].destroy();
});

it('close() resolves while a proxied WebSocket is open', async () => {
  const { pub, pubListener } = await boot(await realtimeStub());
  const ws = await openWs(pub, await signIn(ALLOWED));
  const wsClosed = new Promise((r) => ws.once('close', r));
  await pubListener.close();
  await wsClosed;
});

it('serves one storage on both ports, firing a save hook once per write', async () => {
  const { internal, pub } = await boot();
  const res = await fetch(`${pub}/api/world-settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie: await signIn(ALLOWED) },
    body: JSON.stringify(DEFAULT_WORLD_CONSTANTS),
  });
  expect(res.status).toBe(204);
  expect(await (await fetch(`${internal}/api/world-settings`)).json()).toEqual(DEFAULT_WORLD_CONSTANTS);
  expect(saves).toBe(1);
});
