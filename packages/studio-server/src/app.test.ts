import { createServer, type Server } from 'node:http';
import { connect as netConnect } from 'node:net';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import connect, { type NextHandleFunction } from 'connect';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import session from 'express-session';
import { DEFAULT_WORLD_CONSTANTS } from '@officexr/sdk';
import { createSessionReader } from '@officexr/server';
import { AgentTokenServiceError, type AgentTokens } from '@officexr/studio-mcp/agent-tokens';
import { agentTokenRoutes } from './agent-tokens/routes.ts';
import { ModelSourceServiceError, type ModelSources } from '@officexr/studio-mcp/model-sources';
import { createStudioMcpOptions, HeavyWorkLock, loopbackDocuments, loopbackOrigin, type ViewRenderer } from '@officexr/studio-mcp/mount-mcp';
import { emptyRoomDocument } from '@officexr/world/scenes';
import { createStudioStorage } from '@officexr/world/vite-plugin-storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { createInternalServer, createPublicServer, type StudioListener } from './app.ts';
import { ModelSourcesService } from './model-sources/service.ts';
import { gridGlb, InMemoryModelSourceStore } from './model-sources/test-fixtures.ts';
import { createOAuthApp } from './oauth/index.ts';
import { InMemoryOAuthStore } from './oauth/store.ts';
import { cacheAllowlist, type IsAllowed, type VerifyApiToken } from './studio-gate.ts';
import { signIn as signInAs } from './test-sign-in.ts';

const DOWN = 'http://127.0.0.1:1';
const SECRET = 'test-secret';
const FRONTEND = 'https://studio.example.com';
const ALLOWED = 'allowed@example.com';

let sessionStore: session.MemoryStore;
let isStudioAllowed: IsAllowed;
let isAdmin: IsAllowed;
let verifyApiToken: VerifyApiToken | undefined;

const signIn = (login: string) => signInAs(sessionStore, SECRET, login);

let dir: string;
let saves: number;
const listeners: StudioListener[] = [];

const listen = async (server: Server) => {
  listeners.push({ server, close: () => new Promise((r) => server.close(() => r())) });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return loopbackOrigin(server);
};

/** `oauth` receives the internal server's `/mcp` handler to serve behind bearer auth. */
async function boot(realtimeTarget = DOWN, oauth?: (mcp: NextHandleFunction) => NextHandleFunction, renderer?: ViewRenderer, modelSources: ModelSources | null = null, agentTokens: AgentTokens | null = null) {
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
  const mcp = { ...createStudioMcpOptions({ modelRoot: dir }), ...(renderer && { renderer }) };
  const internal = createInternalServer({
    storage,
    modelsDir,
    uploadedModelsDir,
    studioDist: path.join(dir, 'dist'),
    mcp,
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
    isAdmin: (login) => isAdmin(login),
    verifyApiToken: verifyApiToken && ((token) => verifyApiToken!(token)),
    modelSources,
    agentTokens,
    oauth: oauth?.(internal.mcp),
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
  isAdmin = async (login) => login === ALLOWED;
  verifyApiToken = undefined;
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

it('serves a finalized derivative at its gltfPath on both ports, and the raw source nowhere', async () => {
  const { internal, pub } = await boot();
  const store = new InMemoryModelSourceStore();
  const raw = await gridGlb();
  store.put('packs/kit/chair.glb', raw);
  const service = new ModelSourcesService({
    store,
    catalog: () => loopbackDocuments(internal).catalog,
    heavyWorkLock: new HeavyWorkLock('a bake or render'),
    uploadedModelsDir: path.join(dir, 'uploaded'),
    publishModel: async () => {},
    bundledPacks: async () => new Set(),
  });

  const { kind } = await service.finalize('kit', 'chair.glb');

  const derivative = await readFile(path.join(dir, 'uploaded', 'kit', 'chair.glb'));
  const headers = { cookie: await signIn(ALLOWED) };
  for (const base of [internal, pub]) {
    const served = await fetch(`${base}${kind.gltfPath}`, { headers });
    expect(Buffer.from(await served.arrayBuffer())).toEqual(derivative);
    for (const rawPath of ['/packs/kit/chair.glb', '/models/packs/kit/chair.glb', '/api/packs/kit/chair.glb']) {
      expect((await fetch(`${base}${rawPath}`, { headers })).status).toBe(404);
    }
  }
  expect(derivative.equals(Buffer.from(raw))).toBe(false);
  const catalog = await (await fetch(`${internal}/api/world-object-kinds`)).json();
  expect(catalog.kinds.find((k: { id: string }) => k.id === 'kit/chair')).toMatchObject({ sourceObject: 'packs/kit/chair.glb' });
});

describe('public server', () => {
  it('serves /models but not the SPA, and no /mcp without the OAuth app', async () => {
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
    const { pub } = await boot(DOWN, () => oauth.handler);
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

describe('public bearer API tokens', () => {
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeEach(() => {
    verifyApiToken = async (token) => (token === 'good' ? { login: ALLOWED } : null);
  });

  it('acts as the token user on /api, including /api/me', async () => {
    const { pub } = await boot();
    const me = await fetch(`${pub}/api/me`, { headers: bearer('good') });
    expect(await me.json()).toEqual({ login: ALLOWED, name: ALLOWED });
    expect((await fetch(`${pub}/api/maps`, { headers: bearer('good') })).status).toBe(200);
    expect((await fetch(`${pub}/api/model-sources`, { headers: bearer('good') })).status).toBe(503);
  });

  it('answers 401 invalid_token for a bad token even with a valid cookie', async () => {
    const { pub } = await boot();
    const cookie = await signIn(ALLOWED);
    for (const token of ['garbage', 'expired']) {
      const res = await fetch(`${pub}/api/me`, { headers: { ...bearer(token), cookie } });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Invalid token' });
      expect(res.headers.get('www-authenticate')).toBe('Bearer error="invalid_token"');
    }
  });

  it('re-checks both allowlists on every request', async () => {
    const { pub } = await boot();
    const status = async () => (await fetch(`${pub}/api/maps`, { headers: bearer('good') })).status;
    expect(await status()).toBe(200);
    isAdmin = async () => false;
    expect(await status()).toBe(403);
    isAdmin = async () => true;
    isStudioAllowed = async () => false;
    expect(await status()).toBe(403);
  });

  it('refuses a bearer token on the token approval routes', async () => {
    const { pub } = await boot();
    for (const urlPath of ['/api/agent-token-requests', '/api/agent-token-requests/', '/api/agent-token-requests/abc/approve', '/api/Agent-Token-Requests/abc/approve']) {
      expect((await fetch(`${pub}${urlPath}`, { headers: bearer('good') })).status).toBe(403);
    }
  });

  it('is ignored outside /api, where the cookie rules apply', async () => {
    const { pub } = await boot();
    expect((await fetch(`${pub}/models/chair.glb`, { headers: bearer('good') })).status).toBe(401);
    const res = await fetch(`${pub}/models/chair.glb`, { headers: { ...bearer('garbage'), cookie: await signIn(ALLOWED) } });
    expect(await res.text()).toBe('glb');
  });

  it('is refused with 401 when API tokens are disabled', async () => {
    verifyApiToken = undefined;
    const { pub } = await boot();
    expect((await fetch(`${pub}/api/me`, { headers: { ...bearer('good'), cookie: await signIn(ALLOWED) } })).status).toBe(401);
  });

  it('leaves /mcp to its OAuth token', async () => {
    const oauth = createOAuthApp({ store: new InMemoryOAuthStore(), isAdmin: async () => true, issuerUrl: 'https://studio-api.example.com', webPublicUrl: 'https://web.example.com' });
    const { pub } = await boot(DOWN, () => oauth.handler);
    expect((await fetch(`${pub}/mcp`, { method: 'POST', headers: bearer('good') })).status).toBe(401);
  });
});

describe('public model-source routes', () => {
  const kind = { id: 'kit/a' } as never;
  const calls: unknown[][] = [];
  let failure: ModelSourceServiceError | Error | null;
  const fake: ModelSources = {
    requestUpload: async (...args) => {
      calls.push(['requestUpload', ...args]);
      if (failure) {
        throw failure;
      }
      return { uploads: [] };
    },
    finalize: async (...args) => {
      calls.push(['finalize', ...args]);
      if (failure) {
        throw failure;
      }
      return { kind };
    },
    list: async (...args) => {
      calls.push(['list', ...args]);
      return { packs: [] };
    },
  };
  const post = (origin: string, route: string, body: unknown, cookie: string) =>
    fetch(`${origin}/api/model-sources/${route}`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', origin: FRONTEND },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  const upload = { pack: 'kit', files: [{ path: 'a.glb', sha256: 'a'.repeat(64), sizeBytes: 3 }] };

  beforeEach(() => {
    calls.length = 0;
    failure = null;
  });

  it('answers 401 and 403 through the gate without reaching the service', async () => {
    const { pub } = await boot(DOWN, undefined, undefined, fake);
    expect((await post(pub, 'upload-url', upload, '')).status).toBe(401);
    expect((await fetch(`${pub}/api/model-sources`)).status).toBe(401);
    expect((await post(pub, 'finalize', { pack: 'kit', entry: 'a.glb' }, await signIn('other@example.com'))).status).toBe(403);
    expect(calls).toEqual([]);
  });

  it('serves upload-url, finalize and list for an allowed login', async () => {
    const { pub } = await boot(DOWN, undefined, undefined, fake);
    const cookie = await signIn(ALLOWED);
    const uploadRes = await post(pub, 'upload-url', upload, cookie);
    expect(uploadRes.status).toBe(200);
    expect(uploadRes.headers.get('access-control-allow-credentials')).toBe('true');
    expect(await uploadRes.json()).toEqual({ uploads: [] });
    const finalized = await post(pub, 'finalize', { pack: 'kit', entry: 'a.glb' }, cookie);
    expect(await finalized.json()).toEqual({ kind });
    const listed = await fetch(`${pub}/api/model-sources?pack=kit`, { headers: { cookie } });
    expect(await listed.json()).toEqual({ packs: [] });
    expect(calls).toEqual([['requestUpload', 'kit', upload.files], ['finalize', 'kit', 'a.glb'], ['list', 'kit']]);
  });

  it.each([
    ['validation', 400],
    ['busy', 409],
    ['not_configured', 503],
  ] as const)('maps a %s service error to %i', async (type, status) => {
    const { pub } = await boot(DOWN, undefined, undefined, fake);
    failure = new ModelSourceServiceError({ type, message: 'because' });
    const res = await post(pub, 'finalize', { pack: 'kit', entry: 'a.glb' }, await signIn(ALLOWED));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: 'because' });
  });

  it('answers 500 without the error message for an unexpected failure', async () => {
    const { pub } = await boot(DOWN, undefined, undefined, fake);
    failure = new Error('secret bucket path');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post(pub, 'finalize', { pack: 'kit', entry: 'a.glb' }, await signIn(ALLOWED));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('secret');
  });

  it.each([
    ['upload-url', { pack: 1, files: [] }],
    ['upload-url', { pack: 'kit', files: [{ path: 'a', sha256: 'x' }] }],
    ['upload-url', { pack: 'kit' }],
    ['finalize', { pack: 'kit' }],
    ['finalize', '[1]'],
    ['finalize', '{not json'],
  ])('answers 400 for a malformed %s body without calling the service', async (route, body) => {
    const { pub } = await boot(DOWN, undefined, undefined, fake);
    expect((await post(pub, route, body, await signIn(ALLOWED))).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('answers 413 for an oversized body', async () => {
    const { pub } = await boot(DOWN, undefined, undefined, fake);
    const res = await post(pub, 'finalize', { pack: 'kit', entry: 'x'.repeat(300_000) }, await signIn(ALLOWED));
    expect(res.status).toBe(413);
  });

  it('answers 503 on every route when no service is configured', async () => {
    const { pub } = await boot();
    const cookie = await signIn(ALLOWED);
    expect((await post(pub, 'upload-url', upload, cookie)).status).toBe(503);
    expect((await post(pub, 'finalize', { pack: 'kit', entry: 'a.glb' }, cookie)).status).toBe(503);
    expect((await fetch(`${pub}/api/model-sources`, { headers: { cookie } })).status).toBe(503);
  });

  it('is not served by the internal server', async () => {
    const { internal } = await boot(DOWN, undefined, undefined, fake);
    const res = await fetch(`${internal}/api/model-sources`);
    expect(res.status).not.toBe(200);
    expect(calls).toEqual([]);
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

describe('public /mcp', () => {
  const ISSUER = 'https://studio-api.example.com';
  const METADATA = `${ISSUER}/.well-known/oauth-protected-resource/mcp`;
  const mcpRequest = { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) };

  async function bootWithOAuth(renderer?: ViewRenderer) {
    const store = new InMemoryOAuthStore();
    await store.registerClient({ client_id: 'c', redirect_uris: ['https://client.example.com/cb'] } as OAuthClientInformationFull);
    const booted = await boot(
      DOWN,
      (mcp) => createOAuthApp({ store, isAdmin: async (login) => login === ALLOWED, issuerUrl: ISSUER, webPublicUrl: 'https://web.example.com', mcp }).handler,
      renderer,
    );
    const token = async (value: string, resource = `${ISSUER}/mcp`, login = ALLOWED, expiresAt = new Date(Date.now() + 60_000)) =>
      store.saveToken(value, 'access', { clientId: 'c', login, scopes: [], resource, expiresAt });
    return { ...booted, token };
  }

  const connectClient = async (pub: string, token: string) => {
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${pub}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
    return client;
  };

  it('answers 401 pointing at the resource metadata without a valid token, even for a signed-in studio user', async () => {
    const { pub, token } = await bootWithOAuth();
    await token('other-audience', 'https://elsewhere.example.com/mcp');
    await token('retired-admin', undefined, 'former@example.com');
    await token('expired', undefined, ALLOWED, new Date(Date.now() - 1000));
    const cookie = await signIn(ALLOWED);
    for (const headers of [{} as Record<string, string>, { cookie }, { authorization: 'Bearer nope' }, { authorization: 'Bearer other-audience' }, { authorization: 'Bearer retired-admin' }, { authorization: 'Bearer expired' }]) {
      const res = await fetch(`${pub}/mcp`, { ...mcpRequest, headers: { ...mcpRequest.headers, ...headers } });
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toContain(`resource_metadata="${METADATA}"`);
    }
  });

  it('serves the protected-resource metadata', async () => {
    const { pub } = await bootWithOAuth();
    const metadata = await (await fetch(`${pub}/.well-known/oauth-protected-resource/mcp`)).json();
    expect(metadata.resource).toBe(`${ISSUER}/mcp`);
    expect(metadata.authorization_servers).toEqual([`${ISSUER}/`]);
  });

  it('lists and calls the studio tools for an admin token while the internal /mcp stays open', async () => {
    const rendered: string[] = [];
    const { pub, internal, token } = await bootWithOAuth({
      render: async (origin) => {
        rendered.push(origin);
        return { png: new Uint8Array([1]), bounds: { min: [0, 0, 0], max: [1, 1, 1] } };
      },
    });
    await token('admin-token');
    const client = await connectClient(pub, 'admin-token');
    try {
      expect((await client.listTools()).tools.map((tool) => tool.name)).toContain('list_maps');
      await client.callTool({ name: 'put_room', arguments: { name: 'hall', room: emptyRoomDocument('hall') } });
      expect(await client.callTool({ name: 'list_maps', arguments: {} })).not.toHaveProperty('isError', true);
      expect(await client.callTool({ name: 'render_view', arguments: { target: { type: 'room', name: 'hall' }, camera: 'top' } })).not.toHaveProperty('isError', true);
      expect(rendered).toEqual([internal]);
    } finally {
      await client.close();
    }
    expect((await fetch(`${internal}/mcp`, mcpRequest)).status).toBe(200);
  });

  it('shares the heavy-work lock between the ports', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const { pub, internal, token } = await bootWithOAuth({
      render: async () => {
        await held;
        return { png: new Uint8Array([1]), bounds: { min: [0, 0, 0], max: [1, 1, 1] } };
      },
    });
    await token('admin-token');
    const publicClient = await connectClient(pub, 'admin-token');
    const internalClient = new Client({ name: 'test', version: '0' });
    await internalClient.connect(new StreamableHTTPClientTransport(new URL(`${internal}/mcp`)));
    try {
      await publicClient.callTool({ name: 'put_room', arguments: { name: 'hall', room: emptyRoomDocument('hall') } });
      const args = { target: { type: 'room', name: 'hall' }, camera: 'top' };
      const first = publicClient.callTool({ name: 'render_view', arguments: args });
      await vi.waitFor(async () => expect(await internalClient.callTool({ name: 'render_view', arguments: args })).toHaveProperty('isError', true));
      release();
      expect(await first).not.toHaveProperty('isError', true);
    } finally {
      release();
      await Promise.all([publicClient.close(), internalClient.close()]);
    }
  });
});

describe('public agent-token routes', () => {
  const pending = { id: 'r1', purpose: 'bake', clientId: 'c', createdAt: '2026-01-01T00:00:00Z', expiresAt: '2026-01-01T00:10:00Z' };
  const calls: unknown[][] = [];
  let failure: AgentTokenServiceError | null;
  const fake: AgentTokens = {
    request: async () => {
      throw new Error('unused');
    },
    poll: async () => {
      throw new Error('unused');
    },
    listPending: async (login) => {
      calls.push(['list', login]);
      return [pending];
    },
    approve: async (login, id) => {
      calls.push(['approve', login, id]);
      if (failure) {
        throw failure;
      }
    },
    deny: async (login, id) => {
      calls.push(['deny', login, id]);
      if (failure) {
        throw failure;
      }
    },
  };
  const post = (origin: string, route: string, cookie: string, contentType: string | null = 'application/json') =>
    fetch(`${origin}/api/agent-token-requests/${route}`, {
      method: 'POST',
      headers: { cookie, ...(contentType && { 'content-type': contentType }) },
      body: '{}',
    });

  beforeEach(() => {
    calls.length = 0;
    failure = null;
  });

  it('lists, approves and denies for the cookie user', async () => {
    const { pub } = await boot(DOWN, undefined, undefined, null, fake);
    const cookie = await signIn(ALLOWED);
    const listed = await fetch(`${pub}/api/agent-token-requests`, { headers: { cookie } });
    expect(await listed.json()).toEqual({ requests: [pending] });
    const approved = await post(pub, 'r1/approve', cookie, 'application/json; charset=utf-8');
    expect(await approved.json()).toEqual({ status: 'approved' });
    expect(await (await post(pub, 'r2/deny', cookie)).json()).toEqual({ status: 'denied' });
    expect(calls).toEqual([['list', ALLOWED], ['approve', ALLOWED, 'r1'], ['deny', ALLOWED, 'r2']]);
  });

  it.each([
    ['not_found', 404],
    ['not_pending', 409],
    ['expired', 410],
  ] as const)('maps %s to %i', async (type, status) => {
    const { pub } = await boot(DOWN, undefined, undefined, null, fake);
    failure = new AgentTokenServiceError({ type, message: 'because' });
    const res = await post(pub, 'r1/approve', await signIn(ALLOWED));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: 'because' });
  });

  it('answers 415 without a JSON media type and does not call the service', async () => {
    const { pub } = await boot(DOWN, undefined, undefined, null, fake);
    const cookie = await signIn(ALLOWED);
    expect((await post(pub, 'r1/approve', cookie, 'text/plain')).status).toBe(415);
    expect((await post(pub, 'r1/deny', cookie, null)).status).toBe(415);
    expect(calls).toEqual([]);
  });

  it('refuses with 403 when the routes see no session identity, without calling the service', async () => {
    const app = connect();
    app.use('/api/agent-token-requests', agentTokenRoutes(fake, { sessionIdentity: () => null } as unknown as ReturnType<typeof createSessionReader>));
    const origin = await listen(createServer(app));
    expect((await fetch(`${origin}/api/agent-token-requests`)).status).toBe(403);
    expect((await post(origin, 'r1/approve', '')).status).toBe(403);
    expect(calls).toEqual([]);
  });

  it('answers 404 for a malformed id', async () => {
    const { pub } = await boot(DOWN, undefined, undefined, null, fake);
    expect((await post(pub, '%E0/approve', await signIn(ALLOWED))).status).toBe(404);
    expect(calls).toEqual([]);
  });

  it("passes only the cookie user's login, so another user's id is a 404", async () => {
    const { pub } = await boot(DOWN, undefined, undefined, null, fake);
    failure = new AgentTokenServiceError({ type: 'not_found', message: 'nope' });
    const res = await post(pub, 'theirs/approve', await signIn(ALLOWED));
    expect(res.status).toBe(404);
    expect(calls).toEqual([['approve', ALLOWED, 'theirs']]);
  });

  it('answers 503 for a null service', async () => {
    const { pub } = await boot();
    expect((await fetch(`${pub}/api/agent-token-requests`, { headers: { cookie: await signIn(ALLOWED) } })).status).toBe(503);
  });
});
