import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer, request, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import session from 'express-session';
import type { Profile } from 'passport-google-oauth20';
import type { Connect, PreviewServer, ViteDevServer } from 'vite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  apiMiddleware,
  officexrServer,
  type CreateOffice,
  type Identity,
  type Office,
  type OfficeCharacters,
  type QueryOffices,
  type ResolveIdentity,
  type UpdateOffice,
} from './api';
import { createGoogleStrategy, verifyGoogleProfile, type AuthConfig, type GoogleStrategyFactory, type IsLoginAllowed } from './auth';

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';
const offices: Office[] = [
  { id: ID, name: 'HQ', description: null, map_name: 'hq', created_by_login: 'a@example.com', debug_enabled: false },
  { id: OTHER, name: 'Annex', description: null, map_name: null, created_by_login: null, debug_enabled: false },
];
const modelsDir = mkdtempSync(path.join(tmpdir(), 'officexr-models-'));
mkdirSync(path.join(modelsDir, 'characters'));
writeFileSync(path.join(modelsDir, 'characters', 'Mage.glb'), 'glb');
const outsideFile = path.join(modelsDir, '..', `${path.basename(modelsDir)}-secret.txt`);
writeFileSync(outsideFile, 'secret');
const outsideName = encodeURIComponent(path.basename(outsideFile));
const queryOffices: QueryOffices = async (id) => offices.filter((o) => !id || o.id === id);
const createOffice: CreateOffice = async ({ name, description, mapName, createdByLogin }) => ({
  id: OTHER,
  name,
  description,
  map_name: mapName,
  created_by_login: createdByLogin,
  debug_enabled: false,
});
const updateOffice: UpdateOffice = async (id, { name, description, mapName, debugEnabled }) => {
  const office = offices.find((o) => o.id === id)!;
  return {
    ...office,
    name: name ?? office.name,
    description: description === undefined ? office.description : description,
    map_name: mapName ?? office.map_name,
    debug_enabled: debugEnabled ?? office.debug_enabled,
  };
};
const storedCharacters = new Map<string, string>();
const characters: OfficeCharacters = {
  get: async (officeId, login) => storedCharacters.get(`${officeId}/${login}`) ?? null,
  set: async (officeId, login, characterId) => {
    storedCharacters.set(`${officeId}/${login}`, characterId);
  },
};

/** Mimics connect's `use(base, fn)`: only matching paths reach `fn`, with `base` stripped from `req.url`. */
function mountAt(base: string, fn: Connect.NextHandleFunction): Connect.NextHandleFunction {
  return (req, res, next) => {
    const url = req.url ?? '';
    if (url !== base && !url.startsWith(`${base}/`) && !url.startsWith(`${base}?`)) {
      return next();
    }
    req.url = url.slice(base.length) || '/';
    fn(req, res, (err?: unknown) => {
      req.url = url;
      next(err);
    });
  };
}

let server: Server | undefined;
afterEach(() => server?.close());

type Hook = 'configureServer' | 'configurePreviewServer';

const AUTH: AuthConfig = {
  googleClientId: 'client-id',
  googleClientSecret: 'client-secret',
  sessionSecret: 'session-secret',
  publicUrl: 'http://officexr.test',
};

const isLoginAllowed: IsLoginAllowed = async (email) =>
  ['a@example.com', 'b@example.com'].includes(email) || email.endsWith('@allowed.org');

function googleProfile(email: string, { verified = true, name = '' } = {}): Profile {
  return { emails: [{ value: email, verified }], displayName: name, _json: { email_verified: verified } } as unknown as Profile;
}

/** Token request params the fake Google received, newest last. */
const tokenRequests: Record<string, string>[] = [];
let googleUser: Profile = googleProfile('a@example.com', { name: 'Alice' });

/** The real strategy, state store and PKCE included, with Google's token and profile endpoints faked. */
const fakeGoogle: GoogleStrategyFactory = (config, verify) => {
  const strategy = createGoogleStrategy(config, verify) as unknown as {
    _oauth2: { getOAuthAccessToken: (code: string, params: Record<string, string>, cb: (...args: unknown[]) => void) => void };
    userProfile: (token: string, done: (err: unknown, profile: Profile) => void) => void;
  };
  strategy._oauth2.getOAuthAccessToken = (_code, params, cb) => {
    tokenRequests.push(params);
    cb(null, 'access-token', 'refresh-token', {});
  };
  strategy.userProfile = (_token, done) => done(null, googleUser);
  return strategy as unknown as ReturnType<GoogleStrategyFactory>;
};

interface StartOptions {
  devUser?: Identity;
  auth?: Partial<AuthConfig>;
  sessionStore?: session.Store;
}

async function start(hook: Hook, { devUser, auth = AUTH, sessionStore = new session.MemoryStore() }: StartOptions = {}): Promise<string> {
  const stack: Connect.NextHandleFunction[] = [];
  const fake = {
    middlewares: {
      use: (...args: [Connect.NextHandleFunction] | [string, Connect.NextHandleFunction]) => {
        const [base, fn] = args.length === 2 ? args : [undefined, args[0]];
        stack.push(base ? mountAt(base, fn) : fn);
      },
    },
  };
  const plugins = officexrServer({
    queryOffices,
    characters,
    createOffice,
    updateOffice,
    isLoginAllowed,
    auth,
    sessionStore: () => sessionStore,
    googleStrategy: fakeGoogle,
    devUser,
    modelsDir,
  });
  for (const plugin of plugins) {
    await (plugin[hook] as (s: ViteDevServer | PreviewServer) => unknown)(fake as unknown as ViteDevServer);
  }
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const run = (i: number): void => {
      if (i === stack.length) {
        res.statusCode = 404;
        res.end();
        return;
      }
      stack[i](req, res, () => run(i + 1));
    };
    run(0);
  });
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const cookieOf = (res: Response) => res.headers.getSetCookie()[0]?.split(';')[0];

/** Runs the Google round trip as `user`; `location` is where the callback sends the browser. */
async function googleLogin(base: string, user: Profile, next?: string, tamperState = false) {
  googleUser = user;
  const query = next === undefined ? '' : `?next=${encodeURIComponent(next)}`;
  const authorize = await fetch(`${base}/auth/google${query}`, { redirect: 'manual' });
  const state = new URL(authorize.headers.get('location')!).searchParams.get('state')!;
  const preLogin = cookieOf(authorize);
  const callback = await fetch(`${base}/auth/google/callback?code=c0de&state=${tamperState ? 'forged' : state}`, {
    redirect: 'manual',
    headers: { cookie: preLogin },
  });
  return { authorize, preLogin, callback, location: callback.headers.get('location'), cookie: cookieOf(callback) };
}

async function signIn(base: string, email: string, name = ''): Promise<Record<string, string>> {
  const { cookie } = await googleLogin(base, googleProfile(email, { name }));
  return { cookie: cookie! };
}

/** Sends `path` verbatim; `fetch` would normalise dot segments before the server sees them. */
function rawStatus(base: string, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    request(`${base}${path}`, { path }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    })
      .on('error', reject)
      .end();
  });
}

/** For the direct `apiMiddleware` specs, which skip the session layer. */
const headerIdentity: ResolveIdentity = (req) => {
  const login = req.headers['x-test-login'];
  return typeof login === 'string' ? { login, name: login } : null;
};
const alice = { 'x-test-login': 'a@example.com' };

describe('/api/me', () => {
  it('returns the signed-in Google identity', async () => {
    const base = await start('configurePreviewServer');
    const res = await fetch(`${base}/api/me`, { headers: await signIn(base, 'A@Example.com', 'Alice') });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ login: 'a@example.com', name: 'Alice' });
  });

  it('is 401 without a session, even with Tailscale headers', async () => {
    const base = await start('configurePreviewServer');
    const res = await fetch(`${base}/api/me`, { headers: { 'Tailscale-User-Login': 'a@example.com' } });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Not signed in' });
  });

  it('is the dev user on the dev server, without any auth config', async () => {
    const base = await start('configureServer', { devUser: { login: 'dev@example.com', name: 'Dev' }, auth: {} });
    expect(await (await fetch(`${base}/api/me`)).json()).toEqual({ login: 'dev@example.com', name: 'Dev' });
  });

  it('ignores the dev user on the preview server', async () => {
    const base = await start('configurePreviewServer', { devUser: { login: 'dev@example.com', name: 'Dev' } });
    expect((await fetch(`${base}/api/me`)).status).toBe(401);
  });
});

describe('Google sign-in', () => {
  beforeEach(() => {
    tokenRequests.length = 0;
  });

  it('sends the user to Google with state and a PKCE challenge, and returns to a safe next', async () => {
    const base = await start('configurePreviewServer');
    const { authorize, preLogin, callback, location, cookie } = await googleLogin(base, googleProfile('a@example.com'), '/offices/x?y=1');
    const google = new URL(authorize.headers.get('location')!);
    expect(google.origin).toBe('https://accounts.google.com');
    expect(google.searchParams.get('redirect_uri')).toBe('http://officexr.test/auth/google/callback');
    expect(google.searchParams.get('code_challenge_method')).toBe('S256');
    expect(callback.status).toBe(302);
    expect(location).toBe('/offices/x?y=1');
    expect(tokenRequests[0].code_verifier).toBeTruthy();
    // Login regenerates the session, so a pre-login (possibly planted) cookie never authenticates.
    expect(cookie).not.toBe(preLogin);
    expect((await fetch(`${base}/api/me`, { headers: { cookie: preLogin! } })).status).toBe(401);
    expect(await (await fetch(`${base}/api/me`, { headers: { cookie: cookie! } })).json()).toEqual({
      login: 'a@example.com',
      name: 'a@example.com',
    });
  });

  it.each(['//evil.com', 'https://evil.com', '/\\evil.com', '/\t/evil.com', 'evil', '/日本'])('falls back to / for next=%s', async (next) => {
    const base = await start('configurePreviewServer');
    expect((await googleLogin(base, googleProfile('a@example.com'), next)).location).toBe('/');
  });

  it.each([
    ['unverified', googleProfile('a@example.com', { verified: false })],
    ['not_allowed', googleProfile('eve@example.com')],
  ])('refuses with login_error=%s and no session identity', async (code, user) => {
    const base = await start('configurePreviewServer');
    const { location, cookie } = await googleLogin(base, user, '/offices');
    expect(location).toBe(`/?login_error=${code}`);
    expect((await fetch(`${base}/api/me`, { headers: cookie ? { cookie } : {} })).status).toBe(401);
  });

  it('refuses a callback whose state does not match the session', async () => {
    const base = await start('configurePreviewServer');
    const { location } = await googleLogin(base, googleProfile('a@example.com'), '/', true);
    expect(location).toBe('/?login_error=failed');
    expect(tokenRequests).toEqual([]);
  });

  it('refuses when the user denies consent at Google', async () => {
    const base = await start('configurePreviewServer');
    const res = await fetch(`${base}/auth/google/callback?error=access_denied`, { redirect: 'manual' });
    expect(res.headers.get('location')).toBe('/?login_error=failed');
  });

  it('logout returns 204 and the old cookie no longer authenticates', async () => {
    const base = await start('configurePreviewServer');
    const headers = await signIn(base, 'a@example.com');
    const res = await fetch(`${base}/auth/logout`, { method: 'POST', headers });
    expect(res.status).toBe(204);
    expect(res.headers.getSetCookie()[0]).toMatch(/^officexr\.sid=;.*Expires=Thu, 01 Jan 1970/);
    expect((await fetch(`${base}/api/me`, { headers })).status).toBe(401);
  });

  it('only touches the session store for /auth and /api', async () => {
    const store = new session.MemoryStore();
    const base = await start('configurePreviewServer', { sessionStore: store });
    const headers = await signIn(base, 'a@example.com');
    const reads: string[] = [];
    const get = store.get.bind(store);
    store.get = (sid, cb) => {
      reads.push(sid);
      get(sid, cb);
    };
    await fetch(`${base}/models/characters/Mage.glb`, { headers });
    await fetch(`${base}/config.js`, { headers });
    expect(reads).toEqual([]);
    await fetch(`${base}/api/me`, { headers });
    expect(reads).toHaveLength(1);
  });

  it('fails preview startup naming the missing config', async () => {
    await expect(start('configurePreviewServer', { auth: { publicUrl: 'https://x.test' } })).rejects.toThrow(
      'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SESSION_SECRET',
    );
  });
});

describe('verifyGoogleProfile', () => {
  it.each([
    ['an allowlisted email', googleProfile('b@example.com', { name: 'Bob' }), { login: 'b@example.com', name: 'Bob' }],
    ['an allowlisted domain', googleProfile('c@allowed.org'), { login: 'c@allowed.org', name: 'c@allowed.org' }],
    ['an uppercase email', googleProfile('B@EXAMPLE.COM', { name: 'Bob' }), { login: 'b@example.com', name: 'Bob' }],
    ['an unverified email', googleProfile('b@example.com', { verified: false }), { loginError: 'unverified' }],
    ['an email not allowlisted', googleProfile('c@other.org'), { loginError: 'not_allowed' }],
    ['a lookalike domain', googleProfile('c@notallowed.org.evil'), { loginError: 'not_allowed' }],
  ])('handles %s', async (_label, profile, expected) => {
    expect(await verifyGoogleProfile(profile, isLoginAllowed)).toEqual(expected);
  });
});

describe('/api/offices', () => {
  it('lists offices', async () => {
    const base = await start('configurePreviewServer');
    expect(await (await fetch(`${base}/api/offices`)).json()).toEqual(offices);
  });

  it('returns one office, or 404', async () => {
    const base = await start('configurePreviewServer');
    const office = await (await fetch(`${base}/api/offices/${ID}`)).json();
    expect(office).toEqual(offices[0]);
    expect((await fetch(`${base}/api/offices/22222222-2222-4222-8222-222222222222`)).status).toBe(404);
    expect((await fetch(`${base}/api/offices/not-a-uuid`)).status).toBe(404);
  });
});

describe('POST /api/offices', () => {
  const calls: string[] = [];
  const mapExists = async (name: string) => {
    calls.push(`mapExists:${name}`);
    return name === 'hq';
  };
  const spyCreate: CreateOffice = async (input) => {
    calls.push('createOffice');
    return createOffice(input);
  };
  const middleware = apiMiddleware(queryOffices, characters, spyCreate, updateOffice, mapExists, headerIdentity);

  const post = async (body: unknown, headers: Record<string, string> = alice) => {
    calls.length = 0;
    server = createServer((req, res) => middleware(req, res, () => res.end()));
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return fetch(`${base}/api/offices`, {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  };

  it('creates an office from trimmed input', async () => {
    const res = await post({ name: ' Lab ', description: ' Test ', mapName: 'hq' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      id: OTHER,
      name: 'Lab',
      description: 'Test',
      map_name: 'hq',
      created_by_login: 'a@example.com',
      debug_enabled: false,
    });
    expect(calls).toEqual(['mapExists:hq', 'createOffice']);
  });

  it('is 401 without identity, before reading the body or touching maps', async () => {
    expect((await post({ name: 'Lab', mapName: 'hq' }, {})).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it.each([
    ['a blank name', { name: '  ', mapName: 'hq' }],
    ['a long name', { name: 'x'.repeat(101), mapName: 'hq' }],
    ['a non-string description', { name: 'Lab', description: 3, mapName: 'hq' }],
    ['a long description', { name: 'Lab', description: 'x'.repeat(501), mapName: 'hq' }],
    ['a non-JSON body', '{'],
    ['a missing map', { name: 'Lab' }],
  ])('is 400 for %s without creating', async (_label, body) => {
    expect((await post(body)).status).toBe(400);
    expect(calls).not.toContain('createOffice');
  });

  it('is 400 for a missing name without checking the map', async () => {
    expect((await post({ mapName: 'hq' })).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('is 400 for an unknown map without creating', async () => {
    expect((await post({ name: 'Lab', mapName: 'nope' })).status).toBe(400);
    expect(calls).toEqual(['mapExists:nope']);
  });

  it('is 413 past the body limit without creating', async () => {
    expect((await post({ name: 'Lab', description: 'x'.repeat(5000), mapName: 'hq' })).status).toBe(413);
    expect(calls).toEqual([]);
  });

  it('is 405 for other methods', async () => {
    const base = await start('configurePreviewServer');
    expect((await fetch(`${base}/api/offices`, { method: 'PUT', headers: await signIn(base, 'a@example.com') })).status).toBe(405);
  });
});

describe('PATCH /api/offices/:id', () => {
  const bob = { 'x-test-login': 'b@example.com' };
  const calls: string[] = [];
  const updates: unknown[] = [];
  const spyUpdate: UpdateOffice = async (id, update) => {
    calls.push('updateOffice');
    updates.push(update);
    return updateOffice(id, update);
  };
  const middleware = apiMiddleware(queryOffices, characters, createOffice, spyUpdate, async (name) => name === 'hq' || name === 'default', headerIdentity);

  const patch = async (id: string, body: unknown, headers: Record<string, string> = alice) => {
    calls.length = 0;
    updates.length = 0;
    server = createServer((req, res) => middleware(req, res, () => res.end()));
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return fetch(`${base}/api/offices/${id}`, {
      method: 'PATCH',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  };

  it('updates the creator\'s office with trimmed fields', async () => {
    const res = await patch(ID, { name: ' Lab ', description: ' ', mapName: 'default', debugEnabled: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ...offices[0],
      name: 'Lab',
      description: null,
      map_name: 'default',
      debug_enabled: true,
    });
  });

  it('accepts a subset of fields', async () => {
    const res = await patch(ID, { debugEnabled: true });
    expect(updates).toEqual([{ debugEnabled: true }]);
    expect(await res.json()).toEqual({ ...offices[0], debug_enabled: true });
  });

  it('is 403 for another login, and for an office without a creator', async () => {
    const forbidden = { error: 'Only the office creator can change its settings' };
    for (const [id, headers] of [[ID, bob], [OTHER, alice]] as const) {
      const res = await patch(id, { name: 'Lab' }, headers);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual(forbidden);
    }
    expect(calls).toEqual([]);
  });

  it('is 401 without identity and 404 for unknown or invalid ids', async () => {
    expect((await patch(ID, { name: 'Lab' }, {})).status).toBe(401);
    expect((await patch('22222222-2222-4222-8222-222222222222', { name: 'Lab' })).status).toBe(404);
    expect((await patch('not-a-uuid', { name: 'Lab' })).status).toBe(404);
    expect(calls).toEqual([]);
  });

  it.each([
    ['a blank name', { name: ' ' }],
    ['a long name', { name: 'x'.repeat(101) }],
    ['a non-string description', { description: 3 }],
    ['a long description', { description: 'x'.repeat(501) }],
    ['an unknown map', { mapName: 'nope' }],
    ['a non-boolean debug flag', { debugEnabled: 'yes' }],
    ['a non-JSON body', '{'],
  ])('is 400 for %s without updating', async (_label, body) => {
    expect((await patch(ID, body)).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('is 404 when the office vanishes before the update', async () => {
    const gone = apiMiddleware(queryOffices, characters, createOffice, async () => undefined, async () => true, headerIdentity);
    server = createServer((req, res) => gone(req, res, () => res.end()));
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const res = await fetch(`${base}/api/offices/${ID}`, { method: 'PATCH', headers: alice, body: '{"name":"Lab"}' });
    expect(res.status).toBe(404);
  });

  it('is 413 past the body limit without updating', async () => {
    expect((await patch(ID, { description: 'x'.repeat(5000) })).status).toBe(413);
    expect(calls).toEqual([]);
  });

  it('is 405 for methods other than GET and PATCH', async () => {
    const base = await start('configurePreviewServer');
    expect((await fetch(`${base}/api/offices/${ID}`, { method: 'DELETE', headers: await signIn(base, 'a@example.com') })).status).toBe(405);
  });
});

describe('/api/offices/:id/character', () => {
  let base: string;
  let me: Record<string, string>;
  let bob: Record<string, string>;
  const put = (officeId: string, body: unknown, headers = me) =>
    fetch(`${base}/api/offices/${officeId}/character`, { method: 'PUT', headers, body: JSON.stringify(body) });
  const get = async (officeId: string, headers = me) =>
    (await (await fetch(`${base}/api/offices/${officeId}/character`, { headers })).json()).characterId;
  beforeEach(async () => {
    storedCharacters.clear();
    base = await start('configurePreviewServer');
    me = await signIn(base, 'a@example.com');
    bob = await signIn(base, 'b@example.com');
  });

  it('stores the choice per office and login', async () => {
    expect(await get(ID)).toBeNull();
    expect((await put(ID, { characterId: 'Mage' })).status).toBe(200);
    expect((await put(OTHER, { characterId: 'Knight' })).status).toBe(200);
    expect((await put(ID, { characterId: 'Rogue' }, bob)).status).toBe(200);
    expect(await get(ID)).toBe('Mage');
    expect(await get(OTHER)).toBe('Knight');
    expect(await get(ID, bob)).toBe('Rogue');
  });

  it('rejects unknown characters and malformed bodies', async () => {
    expect((await put(ID, { characterId: 'Dragon' })).status).toBe(400);
    expect((await put(ID, 'not json')).status).toBe(400);
    const raw = await fetch(`${base}/api/offices/${ID}/character`, { method: 'PUT', headers: me, body: '{' });
    expect(raw.status).toBe(400);
    expect((await put(ID, { characterId: 'Mage', pad: 'x'.repeat(5000) })).status).toBe(413);
    expect(await get(ID)).toBeNull();
  });

  it('is 405 for other methods', async () => {
    const res = await fetch(`${base}/api/offices/${ID}/character`, { method: 'DELETE', headers: me });
    expect(res.status).toBe(405);
  });

  it('is 401 without identity and 404 for unknown offices', async () => {
    expect((await fetch(`${base}/api/offices/${ID}/character`)).status).toBe(401);
    const missing = '22222222-2222-4222-8222-222222222222';
    expect((await put(missing, { characterId: 'Mage' })).status).toBe(404);
    expect((await fetch(`${base}/api/offices/${missing}/character`, { headers: me })).status).toBe(404);
    expect((await fetch(`${base}/api/offices/not-a-uuid/character`, { headers: me })).status).toBe(404);
  });
});

describe('studio storage', () => {
  it('serves maps read-only', async () => {
    const base = await start('configurePreviewServer');
    expect((await fetch(`${base}/api/maps/default`)).status).toBe(200);
    for (const method of ['PUT', 'DELETE']) {
      expect((await fetch(`${base}/api/maps/default`, { method, body: method === 'PUT' ? '{}' : undefined })).status).toBe(405);
      expect((await fetch(`${base}/api/world-object-kinds`, { method })).status).toBe(405);
    }
  });
});

describe('/models', () => {
  it('serves model files and 404s outside the models dir', async () => {
    const base = await start('configurePreviewServer');
    const res = await fetch(`${base}/models/characters/Mage.glb`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('model/gltf-binary');
    expect(await res.text()).toBe('glb');
  });

  it('404s paths that escape the models dir', async () => {
    const base = await start('configurePreviewServer');
    expect(await rawStatus(base, `/models/..%2f${outsideName}`)).toBe(404);
    expect(await rawStatus(base, `/models/characters/..%2f..%2f${outsideName}`)).toBe(404);
  });

  it('400s malformed escapes and keeps serving', async () => {
    const base = await start('configurePreviewServer');
    expect(await rawStatus(base, '/models/%E0%A4%A')).toBe(400);
    expect((await fetch(`${base}/models/characters/Mage.glb`)).status).toBe(200);
  });
});

describe('/config.js', () => {
  it('serves OFFICEXR_ASSET_BASE_URL from the environment', async () => {
    process.env.OFFICEXR_ASSET_BASE_URL = 'https://cdn.example.com';
    try {
      const base = await start('configurePreviewServer');
      const res = await fetch(`${base}/config.js`);
      expect(await res.text()).toContain('"OFFICEXR_ASSET_BASE_URL":"https://cdn.example.com"');
    } finally {
      delete process.env.OFFICEXR_ASSET_BASE_URL;
    }
  });

  it('never serves the sign-in secrets', async () => {
    process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
    process.env.SESSION_SECRET = 'session-secret';
    try {
      const base = await start('configurePreviewServer');
      const body = await (await fetch(`${base}/config.js`)).text();
      expect(body).not.toContain('google-secret');
      expect(body).not.toContain('session-secret');
    } finally {
      delete process.env.GOOGLE_CLIENT_SECRET;
      delete process.env.SESSION_SECRET;
    }
  });
});
