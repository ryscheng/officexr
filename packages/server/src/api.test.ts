import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { signJoinToken, verifyJoinToken } from '@officexr/realtime-server/join-token';
import { RealtimeServer } from '@officexr/realtime-server/server';
import connect from 'connect';
import session from 'express-session';
import { decodeProtectedHeader, jwtVerify } from 'jose';
import type { Profile } from 'passport-google-oauth20';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiMiddleware, type CreateOffice, type OfficeCharacters, type OfficeDeskClaims, type QueryOffices, type ResolveIdentity, type UpdateOffice } from './api';
import { createApp } from './app';
import { isAllowedOrigin, parseFrontendOrigins } from './cors';
import { JAAS_TOKEN_TTL_SECONDS, jaasConfigFromEnv, jaasUserId, type JaasConfig } from './jaasToken';
import { PREVIEW_TOKEN_TTL_SECONDS, PreviewTokens } from './previewToken';
import { PREVIEW_TOKEN_PARAM } from './previewTokenBrowser';
import { createGoogleStrategy, createSessionReader, emailDomain, parseCookieDomain, safeReturnTarget, verifyGoogleProfile, type AuthConfig, type GoogleStrategyFactory, type IsLoginAllowed } from './auth';
import type { Identity, Office } from './shared';

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
const deskArea = (id: string) => ({ id, min: { x: 0, z: 0 }, max: { x: 1, z: 1 } });
const studioDataDir = mkdtempSync(path.join(tmpdir(), 'officexr-studio-'));
mkdirSync(path.join(studioDataDir, 'maps'));
const baseMap = JSON.parse(readFileSync(path.resolve(__dirname, '../../world/maps/default.json'), 'utf8'));
for (const [name, ids] of [['hq', ['d1', 'd2']], ['default', ['dd']]] as const) {
  writeFileSync(path.join(studioDataDir, 'maps', `${name}.json`), JSON.stringify({ ...baseMap, deskAreas: ids.map(deskArea) }));
}
const NECROMANCER = 'kaykit-skeletons/characters/gltf/Necromancer';
const catalogKind = (id: string, category: string) => ({ id, label: id, gltfPath: `/models/${id}.glb`, swatch: '#64748b', category });
writeFileSync(
  path.join(studioDataDir, 'world-object-kinds.json'),
  JSON.stringify({ schemaVersion: 1, updatedAt: 1, kinds: [catalogKind(NECROMANCER, 'character'), catalogKind('kaykit-skeletons/assets/gltf/Skeleton_Axe', 'prop')] }),
);
const claimsByOffice = new Map<string, Map<string, string>>();
const deskClaims: OfficeDeskClaims = {
  list: async (officeId) => Object.fromEntries(claimsByOffice.get(officeId) ?? []),
  claim: async (officeId, login, deskId) => {
    const claims = claimsByOffice.get(officeId) ?? new Map<string, string>();
    claimsByOffice.set(officeId, claims);
    if (claims.has(deskId) && claims.get(deskId) !== login) {
      return 'taken';
    }
    for (const [desk, holder] of claims) {
      if (holder === login) {
        claims.delete(desk);
      }
    }
    claims.set(deskId, login);
    return 'ok';
  },
  release: async (officeId, login) => {
    const claims = claimsByOffice.get(officeId) ?? new Map<string, string>();
    for (const [desk, holder] of claims) {
      if (holder === login) {
        claims.delete(desk);
      }
    }
  },
};
const storedCharacters = new Map<string, string>();
const characters: OfficeCharacters = {
  get: async (officeId, login) => storedCharacters.get(`${officeId}/${login}`) ?? null,
  set: async (officeId, login, characterId) => {
    storedCharacters.set(`${officeId}/${login}`, characterId);
  },
};

let server: Server | undefined;
afterEach(() => server?.close());

/** `dev` passes `createApp` its dev options, as the web dev server does; `prod` doesn't, as `main.ts` doesn't. */
type Mode = 'dev' | 'prod';

const AUTH: AuthConfig = {
  googleClientId: 'client-id',
  googleClientSecret: 'client-secret',
  sessionSecret: 'session-secret',
  publicUrl: 'http://officexr.test',
};

const isLoginAllowed: IsLoginAllowed = async (email) =>
  ['a@example.com', 'b@example.com'].includes(email) || emailDomain(email) === 'allowed.org';

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
  realtimeTokenSecret?: string;
  frontendOrigins?: string[];
  cookieDomain?: string;
  studioDataDir?: string;
  jaas?: JaasConfig;
}

async function start(
  mode: Mode,
  { devUser, auth = AUTH, sessionStore = new session.MemoryStore(), realtimeTokenSecret, frontendOrigins, cookieDomain, studioDataDir, jaas }: StartOptions = {},
): Promise<string> {
  const app = await createApp({
    queryOffices,
    characters,
    deskClaims,
    createOffice,
    updateOffice,
    isLoginAllowed,
    auth,
    sessionStore: () => sessionStore,
    googleStrategy: fakeGoogle,
    realtime: new RealtimeServer(),
    realtimeTokenSecret,
    jaas,
    frontendOrigins,
    cookieDomain,
    modelsDir,
    studioDataDir,
    dev: mode === 'dev' ? { user: devUser } : undefined,
  });
  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const cookieOf = (res: Response) => res.headers.getSetCookie().find((c) => !c.startsWith('officexr.sid=;'))?.split(';')[0] as string;

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

const apiDeps = {
  queryOffices,
  characters,
  deskClaims,
  createOffice,
  updateOffice,
  mapExists: async () => true,
  loadMap: async () => null,
  loadCatalogCharacters: async () => new Map(),
};
const alice = { 'x-test-login': 'a@example.com' };

describe('/api/realtime-token', () => {
  it('is 401 without a session', async () => {
    const base = await start('prod', { realtimeTokenSecret: 's3cret' });
    expect((await fetch(`${base}/api/realtime-token`)).status).toBe(401);
  });

  it("mints a token the realtime server's verifier accepts for the session's login", async () => {
    const base = await start('prod', { realtimeTokenSecret: 's3cret' });
    const res = await fetch(`${base}/api/realtime-token`, { headers: await signIn(base, 'a@example.com') });
    expect(res.status).toBe(200);
    const { token } = (await res.json()) as { token: string };
    expect(verifyJoinToken('s3cret', token)).toEqual({ login: 'a@example.com' });
    expect(verifyJoinToken('other', token)).toBeNull();
  });

  it('uses the dev user in dev', async () => {
    const base = await start('dev', { devUser: { login: 'dev@example.com', name: 'Dev' }, auth: {}, realtimeTokenSecret: 's3cret' });
    const { token } = (await (await fetch(`${base}/api/realtime-token`)).json()) as { token: string };
    expect(verifyJoinToken('s3cret', token)).toEqual({ login: 'dev@example.com' });
  });

  it.each([undefined, ''])('is 404 when the secret is %j', async (secret) => {
    const base = await start('prod', { realtimeTokenSecret: secret });
    expect((await fetch(`${base}/api/realtime-token`, { headers: await signIn(base, 'a@example.com') })).status).toBe(404);
  });
});

describe('/api/offices/:id/voice-token', () => {
  // A throwaway keypair: the test never touches a real JaaS key.
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const jaas = jaasConfigFromEnv({ VITE_JAAS_APP_ID: 'vpaas-magic-cookie-test', OFFICEXR_JAAS_API_KEY_ID: 'kid-1', OFFICEXR_JAAS_PRIVATE_KEY: pem })!;
  const url = (base: string, id = ID) => `${base}/api/offices/${id}/voice-token`;

  it('is 401 without a session', async () => {
    const base = await start('prod', { jaas });
    const res = await fetch(url(base));
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain('.');
  });

  it("mints a JaaS token for the session's user that verifies with the matching public key", async () => {
    const base = await start('prod', { jaas });
    const before = Math.floor(Date.now() / 1000);
    // Client-supplied identity is ignored: only the session decides who the token is for.
    const res = await fetch(`${url(base)}?name=Mallory&id=evil&moderator=false`, { headers: { ...(await signIn(base, 'a@example.com', 'Alice')), 'x-test-login': 'b@example.com' } });
    expect(res.status).toBe(200);
    const { token, expiresAt } = (await res.json()) as { token: string; expiresAt: number };
    const { payload } = await jwtVerify(token, publicKey, { algorithms: ['RS256'], issuer: 'chat', audience: 'jitsi', subject: 'vpaas-magic-cookie-test' });
    expect(decodeProtectedHeader(token)).toEqual({ alg: 'RS256', kid: 'kid-1', typ: 'JWT' });
    expect(payload).toMatchObject({
      room: '*',
      context: {
        user: { moderator: true, name: 'Alice', id: jaasUserId('a@example.com'), avatar: '', email: '' },
        features: { livestreaming: 'false', recording: 'false', transcription: 'false', 'outbound-call': 'false' },
      },
    });
    expect(payload.iat).toBeGreaterThanOrEqual(before);
    expect(payload.exp).toBe(payload.iat! + JAAS_TOKEN_TTL_SECONDS);
    expect(payload.nbf).toBe(payload.iat! - 60);
    expect(expiresAt).toBe(payload.exp! * 1000);
    expect(JSON.stringify(payload)).not.toContain('a@example.com');
  });

  it('does not verify with another key', async () => {
    const base = await start('prod', { jaas });
    const { token } = (await (await fetch(url(base), { headers: await signIn(base, 'a@example.com') })).json()) as { token: string };
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey;
    await expect(jwtVerify(token, other)).rejects.toThrow();
  });

  it('is 404 for an unknown office', async () => {
    const base = await start('prod', { jaas });
    const headers = await signIn(base, 'a@example.com');
    expect((await fetch(url(base, '22222222-2222-4222-8222-222222222222'), { headers })).status).toBe(404);
    expect((await fetch(url(base, 'nope'), { headers })).status).toBe(404);
  });

  it('is 404 when JaaS is not configured', async () => {
    const base = await start('prod');
    expect((await fetch(url(base), { headers: await signIn(base, 'a@example.com') })).status).toBe(404);
  });

  it('is 405 for anything but GET', async () => {
    const base = await start('prod', { jaas });
    expect((await fetch(url(base), { method: 'POST', headers: await signIn(base, 'a@example.com') })).status).toBe(405);
  });

  it('accepts the base64 of the PEM, and escaped newlines, as the deployed env stores it', async () => {
    const env = { VITE_JAAS_APP_ID: 'app', OFFICEXR_JAAS_API_KEY_ID: 'kid' };
    expect(jaasConfigFromEnv({ ...env, OFFICEXR_JAAS_PRIVATE_KEY: Buffer.from(pem).toString('base64') })).toBeDefined();
    expect(jaasConfigFromEnv({ ...env, OFFICEXR_JAAS_PRIVATE_KEY: pem.replace(/\n/g, '\\n') })).toBeDefined();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(jaasConfigFromEnv({ ...env, OFFICEXR_JAAS_PRIVATE_KEY: 'garbage' })).toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('voice is off'));
    error.mockRestore();
    expect(jaasConfigFromEnv(env)).toBeUndefined();
  });

  it('falls back to the deprecated VITE_ names, with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const legacy = jaasConfigFromEnv({ VITE_JAAS_APP_ID: 'app', VITE_JAAS_API_KEY_ID: 'old-kid', VITE_JAAS_PRIVATE_KEY: Buffer.from(pem).toString('base64') });
    expect(legacy?.apiKeyId).toBe('old-kid');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('deprecated'));
    warn.mockRestore();
  });
});

describe('bearer api tokens', () => {
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const apiToken = (secret = 's3cret', now = Date.now(), ttlMs = 60_000) => signJoinToken(secret, { login: 'rt@example.com', ttlMs, now, aud: 'api' });
  const devOptions = { devUser: { login: 'dev@example.com', name: 'Dev' }, auth: {}, realtimeTokenSecret: 's3cret' };

  it('authenticate the API as the token login, ahead of the dev user', async () => {
    const base = await start('dev', devOptions);
    const res = await fetch(`${base}/api/me`, { headers: bearer(apiToken()) });
    expect(await res.json()).toEqual({ login: 'rt@example.com', name: 'rt@example.com' });
  });

  it('take precedence over a signed-in session', async () => {
    const base = await start('prod', { realtimeTokenSecret: 's3cret' });
    const cookie = await signIn(base, 'a@example.com');
    const res = await fetch(`${base}/api/me`, { headers: { ...cookie, ...bearer(apiToken()) } });
    expect(((await res.json()) as Identity).login).toBe('rt@example.com');
  });

  it('are 401 when forged or expired, even in dev or with a session', async () => {
    const dev = await start('dev', devOptions);
    const expired = apiToken('s3cret', Date.now() - 120_000, 1_000);
    for (const token of [apiToken('other'), expired, 'garbage']) {
      expect((await fetch(`${dev}/api/me`, { headers: bearer(token) })).status).toBe(401);
    }
    const prod = await start('prod', { realtimeTokenSecret: 's3cret' });
    const cookie = await signIn(prod, 'a@example.com');
    expect((await fetch(`${prod}/api/me`, { headers: { ...cookie, ...bearer('garbage') } })).status).toBe(401);
  });

  it('are not satisfied by a browser join token, so it cannot renew itself', async () => {
    const base = await start('prod', { realtimeTokenSecret: 's3cret' });
    const joinToken = signJoinToken('s3cret', { login: 'a@example.com', ttlMs: 60_000 });
    expect((await fetch(`${base}/api/me`, { headers: bearer(joinToken) })).status).toBe(401);
    expect((await fetch(`${base}/api/realtime-token`, { headers: bearer(joinToken) })).status).toBe(401);
  });

  it('are ignored without a configured secret', async () => {
    const base = await start('dev', { devUser: devOptions.devUser, auth: {} });
    expect(((await (await fetch(`${base}/api/me`, { headers: bearer(apiToken()) })).json()) as Identity).login).toBe('dev@example.com');
  });

  it('leave a non-Bearer Authorization header to the session', async () => {
    const base = await start('prod', { realtimeTokenSecret: 's3cret' });
    const cookie = await signIn(base, 'a@example.com');
    const res = await fetch(`${base}/api/me`, { headers: { ...cookie, authorization: 'Basic dXNlcjpwYXNz' } });
    expect(((await res.json()) as Identity).login).toBe('a@example.com');
  });
});

describe('/api/me', () => {
  it('returns the signed-in Google identity', async () => {
    const base = await start('prod');
    const res = await fetch(`${base}/api/me`, { headers: await signIn(base, 'A@Example.com', 'Alice') });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ login: 'a@example.com', name: 'Alice' });
  });

  it('is 401 without a session, even with Tailscale headers', async () => {
    const base = await start('prod');
    const res = await fetch(`${base}/api/me`, { headers: { 'Tailscale-User-Login': 'a@example.com' } });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Not signed in' });
  });

  it('is the dev user in dev, without any auth config', async () => {
    const base = await start('dev', { devUser: { login: 'dev@example.com', name: 'Dev' }, auth: {} });
    expect(await (await fetch(`${base}/api/me`)).json()).toEqual({ login: 'dev@example.com', name: 'Dev' });
  });
});

describe('Google sign-in', () => {
  beforeEach(() => {
    tokenRequests.length = 0;
  });

  it('sends the user to Google with state and a PKCE challenge, and returns to a safe next', async () => {
    const base = await start('prod');
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

  it('round-trips a URL-encoded next with its own query string', async () => {
    const base = await start('prod');
    expect((await googleLogin(base, googleProfile('a@example.com'), '/room/abc?x=1&y=2?z')).location).toBe('/room/abc?x=1&y=2?z');
  });

  it.each(['//evil.com', 'https://evil.com', '/\\evil.com', '/\t/evil.com', 'evil', '/日本'])('falls back to / for next=%s', async (next) => {
    const base = await start('prod');
    expect((await googleLogin(base, googleProfile('a@example.com'), next)).location).toBe('/');
  });

  it.each([
    ['unverified', googleProfile('a@example.com', { verified: false })],
    ['not_allowed', googleProfile('eve@example.com')],
  ])('refuses with login_error=%s and no session identity', async (code, user) => {
    const base = await start('prod');
    const { location, cookie } = await googleLogin(base, user, '/offices');
    expect(location).toBe(`/?login_error=${code}`);
    expect((await fetch(`${base}/api/me`, { headers: cookie ? { cookie } : {} })).status).toBe(401);
  });

  it('refuses a callback whose state does not match the session', async () => {
    const base = await start('prod');
    const { location } = await googleLogin(base, googleProfile('a@example.com'), '/', true);
    expect(location).toBe('/?login_error=failed');
    expect(tokenRequests).toEqual([]);
  });

  it('refuses when the user denies consent at Google', async () => {
    const base = await start('prod');
    const res = await fetch(`${base}/auth/google/callback?error=access_denied`, { redirect: 'manual' });
    expect(res.headers.get('location')).toBe('/?login_error=failed');
  });

  it('logout returns 204 and the old cookie no longer authenticates', async () => {
    const base = await start('prod');
    const headers = await signIn(base, 'a@example.com');
    const res = await fetch(`${base}/auth/logout`, { method: 'POST', headers });
    expect(res.status).toBe(204);
    expect(res.headers.getSetCookie()[0]).toMatch(/^officexr\.sid=;.*Expires=Thu, 01 Jan 1970/);
    expect((await fetch(`${base}/api/me`, { headers })).status).toBe(401);
  });

  it('only touches the session store for /auth and /api', async () => {
    const store = new session.MemoryStore();
    const base = await start('prod', { sessionStore: store });
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

  it('fails startup without dev options, naming the missing config', async () => {
    await expect(start('prod', { auth: { publicUrl: 'https://x.test' } })).rejects.toThrow(
      'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SESSION_SECRET',
    );
    await expect(start('prod', { auth: { ...AUTH, sessionSecret: '' } })).rejects.toThrow(/SESSION_SECRET$/);
  });

  it('fails startup without dev options on a PUBLIC_URL without a scheme', async () => {
    await expect(start('prod', { auth: { ...AUTH, publicUrl: 'officexr.example.com' } })).rejects.toThrow(/PUBLIC_URL$/);
  });

  it('keeps the dev user in dev while Google sign-in is mounted', async () => {
    const base = await start('dev', { devUser: { login: 'dev@example.com', name: 'Dev' } });
    expect(await (await fetch(`${base}/api/me`)).json()).toEqual({ login: 'dev@example.com', name: 'Dev' });
    const authorize = await fetch(`${base}/auth/google`, { redirect: 'manual' });
    expect(new URL(authorize.headers.get('location')!).origin).toBe('https://accounts.google.com');
  });
});

const STUDIO = 'https://studio.karibalabs.co';
const ORIGINS = [STUDIO, 'https://other.karibalabs.co:8443'];
const CORS_HEADERS = ['origin', 'credentials', 'methods', 'headers', 'max-age'].map((h) => `access-control-allow-${h}`);
const corsHeaders = (res: Response) => CORS_HEADERS.filter((h) => res.headers.has(h));

describe('CORS', () => {
  it('answers an allowlisted preflight with 204 and the credentialed headers', async () => {
    const base = await start('prod', { frontendOrigins: ORIGINS });
    const res = await fetch(`${base}/api/offices`, {
      method: 'OPTIONS',
      headers: { origin: STUDIO, 'access-control-request-method': 'PUT', 'access-control-request-headers': 'content-type' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(STUDIO);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    expect(res.headers.get('access-control-allow-methods')).toBe('GET,HEAD,POST,PUT,PATCH,DELETE');
    expect(res.headers.get('access-control-allow-headers')).toBe('Content-Type,Authorization');
    expect(res.headers.get('access-control-max-age')).toBe('600');
  });

  it.each(['https://evil.example', 'http://studio.karibalabs.co', 'https://studio.karibalabs.co:444', 'null'])(
    'sends no Access-Control headers to %s, preflight or not',
    async (origin) => {
      const base = await start('prod', { frontendOrigins: ORIGINS });
      const preflight = await fetch(`${base}/api/offices`, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'PUT' } });
      expect(corsHeaders(preflight)).toEqual([]);
      expect(corsHeaders(await fetch(`${base}/api/me`, { headers: { origin } }))).toEqual([]);
    },
  );

  it('lets an allowed origin read /api/me with credentials', async () => {
    const base = await start('prod', { frontendOrigins: ORIGINS });
    const headers = await signIn(base, 'a@example.com');
    const res = await fetch(`${base}/api/me`, { headers: { ...headers, origin: STUDIO } });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(STUDIO);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it.each([STUDIO, 'https://evil.example', undefined])('varies on Origin even for origin %s', async (origin) => {
    const base = await start('prod', { frontendOrigins: ORIGINS });
    const res = await fetch(`${base}/models/characters/Mage.glb`, { headers: origin ? { origin } : {} });
    expect(res.headers.get('vary')).toMatch(/\bOrigin\b/);
  });

  it('is off when no origins are configured', async () => {
    const base = await start('prod');
    const preflight = await fetch(`${base}/api/me`, { method: 'OPTIONS', headers: { origin: STUDIO, 'access-control-request-method': 'GET' } });
    expect(corsHeaders(preflight)).toEqual([]);
    expect(corsHeaders(await fetch(`${base}/api/me`, { headers: { origin: STUDIO } }))).toEqual([]);
  });
});

describe('parseFrontendOrigins', () => {
  it('splits, trims and skips empties; unset is empty', () => {
    expect(parseFrontendOrigins(` ${STUDIO}, http://localhost:5173 ,`)).toEqual([STUDIO, 'http://localhost:5173']);
    expect(parseFrontendOrigins(undefined)).toEqual([]);
    expect(parseFrontendOrigins('')).toEqual([]);
  });

  it.each(['studio.karibalabs.co', `${STUDIO}/`, `${STUDIO}/app`, 'ftp://studio.karibalabs.co', 'https://', `${STUDIO}?x=1`, '*'])('rejects %s', (bad) => {
    expect(() => parseFrontendOrigins(`${STUDIO},${bad}`)).toThrow(/FRONTEND_ORIGINS/);
  });
});

describe('wildcard frontend origins', () => {
  const PREVIEWS = 'https://*.officexr.pages.dev';
  const PREVIEW = 'https://3f2a9c1b.officexr.pages.dev';

  it('parses an https wildcard after an exact first origin', () => {
    expect(parseFrontendOrigins(`${STUDIO}, ${PREVIEWS}`)).toEqual([STUDIO, PREVIEWS]);
  });

  it.each(['https://*', 'https://*.dev', 'http://*.officexr.pages.dev', 'https://*officexr.pages.dev', 'https://a.*.pages.dev', 'https://*.*.pages.dev', 'https://*.officexr.pages.dev/', 'https://*.OfficeXR.pages.dev'])(
    'rejects %s',
    (bad) => {
      expect(() => parseFrontendOrigins(`${STUDIO},${bad}`)).toThrow(/FRONTEND_ORIGINS/);
    },
  );

  it('rejects a wildcard as the first origin', () => {
    expect(() => parseFrontendOrigins(`${PREVIEWS},${STUDIO}`)).toThrow(/exact origin/);
  });

  it.each([PREVIEW, 'https://feature-branch.officexr.pages.dev'])('allows %s', (origin) => {
    expect(isAllowedOrigin(origin, [STUDIO, PREVIEWS])).toBe(true);
  });

  it.each([
    'https://officexr.pages.dev',
    'https://.officexr.pages.dev',
    'https://a.b.officexr.pages.dev',
    'https://evil.com/.officexr.pages.dev',
    'https://evilofficexr.pages.dev',
    'https://-x.officexr.pages.dev',
    'http://abc.officexr.pages.dev',
    'https://abc.officexr.pages.dev:8443',
    'https://abc.officexr.pages.dev.evil.com',
    undefined,
  ])('refuses %s', (origin) => {
    expect(isAllowedOrigin(origin, [STUDIO, PREVIEWS])).toBe(false);
  });

  it('gives a preview origin credentialed CORS and accepts it as a sign-in return target', async () => {
    const base = await start('prod', { frontendOrigins: [STUDIO, PREVIEWS] });
    const res = await fetch(`${base}/api/offices`, { method: 'OPTIONS', headers: { origin: PREVIEW, 'access-control-request-method': 'PUT' } });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(PREVIEW);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    expect(safeReturnTarget(`${PREVIEW}/studio/`, [STUDIO, PREVIEWS])).toBe(`${PREVIEW}/studio/`);
    expect(safeReturnTarget('https://officexr.pages.dev/', [STUDIO, PREVIEWS])).toBe(`${STUDIO}/`);
  });
});

describe('preview tokens', () => {
  const PREVIEWS = 'https://*.officexr-5zb.pages.dev';
  const PREVIEW = 'https://297c4523.officexr-5zb.pages.dev';
  const ORIGINS_WITH_PREVIEWS = ['http://app.officexr.test', PREVIEWS];
  const tokenIn = (location: string | null) => new URLSearchParams(new URL(location!).hash.slice(1)).get(PREVIEW_TOKEN_PARAM);
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  it('hands a sign-in returning to a cross-site preview a token that works as a bearer for /api/me', async () => {
    const base = await start('prod', { frontendOrigins: ORIGINS_WITH_PREVIEWS, cookieDomain: 'officexr.test' });
    const { location } = await googleLogin(base, googleProfile('a@example.com', { name: 'Alice' }), `${PREVIEW}/room/x?y=1#old`);
    expect(location!.startsWith(`${PREVIEW}/room/x?y=1#${PREVIEW_TOKEN_PARAM}=`)).toBe(true);
    const res = await fetch(`${base}/api/me`, { headers: { ...bearer(tokenIn(location)!), origin: PREVIEW } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ login: 'a@example.com', name: 'Alice' });
    expect(res.headers.get('access-control-allow-origin')).toBe(PREVIEW);
  });

  it.each(['http://app.officexr.test/room/x', '/room/x'])('hands no token to %s, which the cookie reaches', async (next) => {
    const base = await start('prod', { frontendOrigins: ORIGINS_WITH_PREVIEWS, cookieDomain: 'officexr.test' });
    const { location } = await googleLogin(base, googleProfile('a@example.com'), next);
    expect(location).toBe(next);
  });

  it('hands no token to a preview that is not allowlisted', async () => {
    const base = await start('prod', { frontendOrigins: ['http://app.officexr.test'], cookieDomain: 'officexr.test' });
    const { location } = await googleLogin(base, googleProfile('a@example.com'), `${PREVIEW}/`);
    expect(location).toBe('http://app.officexr.test/');
  });

  it('refuses expired, forged and foreign tokens without falling back to the cookie', async () => {
    const base = await start('prod', { frontendOrigins: ORIGINS_WITH_PREVIEWS });
    const { cookie } = await signIn(base, 'a@example.com');
    const at = (ms: number) => new PreviewTokens({ sessionSecret: AUTH.sessionSecret, issuer: AUTH.publicUrl, now: () => new Date(ms) });
    const identity = { login: 'a@example.com', name: 'A' };
    const expired = await at(Date.now() - (PREVIEW_TOKEN_TTL_SECONDS + 10) * 1000).sign(identity);
    const valid = await at(Date.now()).sign(identity);
    const forged = await new PreviewTokens({ sessionSecret: 'other-secret', issuer: AUTH.publicUrl }).sign(identity);
    const otherIssuer = await new PreviewTokens({ sessionSecret: AUTH.sessionSecret, issuer: 'http://elsewhere.test' }).sign(identity);
    for (const token of [expired, forged, otherIssuer, `${valid}x`, 'garbage']) {
      expect((await fetch(`${base}/api/me`, { headers: { ...bearer(token), cookie } })).status).toBe(401);
    }
    expect((await fetch(`${base}/api/me`, { headers: bearer(valid) })).status).toBe(200);
  });

  it('expires after ten minutes', async () => {
    let now = Date.UTC(2026, 0, 1);
    const tokens = new PreviewTokens({ sessionSecret: 's', issuer: 'http://officexr.test', now: () => new Date(now) });
    const token = await tokens.sign({ login: 'a@example.com', name: 'A' });
    now += (PREVIEW_TOKEN_TTL_SECONDS - 1) * 1000;
    expect(await tokens.verify(token)).toEqual({ login: 'a@example.com', name: 'A' });
    now += 10 * 1000;
    expect(await tokens.verify(token)).toBeNull();
  });
});

describe('parseCookieDomain', () => {
  it('accepts the host itself or a parent domain; unset or empty is undefined', () => {
    expect(parseCookieDomain('karibalabs.co', 'api.karibalabs.co')).toBe('karibalabs.co');
    expect(parseCookieDomain('api.karibalabs.co', 'api.karibalabs.co')).toBe('api.karibalabs.co');
    expect(parseCookieDomain(undefined, 'api.karibalabs.co')).toBeUndefined();
    expect(parseCookieDomain(' ', 'api.karibalabs.co')).toBeUndefined();
  });

  it('rejects an IP host', () => {
    expect(() => parseCookieDomain('127.0.0.1', '127.0.0.1')).toThrow(/COOKIE_DOMAIN/);
    expect(() => parseCookieDomain('0.1', '[::1]')).toThrow(/COOKIE_DOMAIN/);
  });

  it.each(['example.com', 'labs.co', '.karibalabs.co', 'co', 'com', 'karibalabs.co/x'])('rejects %s for api.karibalabs.co', (bad) => {
    expect(() => parseCookieDomain(bad, 'api.karibalabs.co')).toThrow(/COOKIE_DOMAIN/);
  });
});

describe('safeReturnTarget', () => {
  it('accepts relative paths and allowlisted absolute URLs', () => {
    expect(safeReturnTarget('/offices/x?y=1', ORIGINS)).toBe('/offices/x?y=1');
    expect(safeReturnTarget('/offices', [])).toBe('/offices');
    expect(safeReturnTarget(`${STUDIO}/studio/?a=1#h`, ORIGINS)).toBe(`${STUDIO}/studio/?a=1#h`);
    expect(safeReturnTarget('https://other.karibalabs.co:8443/x', ORIGINS)).toBe('https://other.karibalabs.co:8443/x');
  });

  it.each([
    'https://evil.example/',
    `${STUDIO}.evil.example/`,
    `${STUDIO}@evil.example/`,
    'https://studio.karibalabs.co:444/',
    'http://studio.karibalabs.co/',
    '//evil.example',
    `${STUDIO}\\@evil.example/`,
    '/\\evil.example',
    '/	/evil.example',
    `${STUDIO}/
`,
    'javascript:alert(1)',
    `blob:${STUDIO}/uuid`,
    'https://studio.karibalabs.co:pw@studio.karibalabs.co/',
    'https://user@studio.karibalabs.co/',
    'evil',
    '/日本',
    '',
    undefined,
    ['/x'],
  ])('falls back to the first origin for %s', (next) => {
    expect(safeReturnTarget(next, ORIGINS)).toBe(`${STUDIO}/`);
  });

  it('falls back to / without origins, and rejects absolute URLs', () => {
    expect(safeReturnTarget(`${STUDIO}/x`, [])).toBe('/');
    expect(safeReturnTarget(undefined, [])).toBe('/');
  });
});

describe('sign-in with frontend origins', () => {
  it('returns to an allowlisted absolute next, and to the first origin otherwise', async () => {
    const base = await start('prod', { frontendOrigins: ORIGINS, cookieDomain: 'karibalabs.co' });
    expect((await googleLogin(base, googleProfile('a@example.com'), `${STUDIO}/studio/`)).location).toBe(`${STUDIO}/studio/`);
    expect((await googleLogin(base, googleProfile('a@example.com'), 'https://evil.example/')).location).toBe(`${STUDIO}/`);
    expect((await googleLogin(base, googleProfile('a@example.com'))).location).toBe(`${STUDIO}/`);
  });

  it('sends every failure to the first origin', async () => {
    const base = await start('prod', { frontendOrigins: ORIGINS });
    expect((await googleLogin(base, googleProfile('eve@example.com'), '/x')).location).toBe(`${STUDIO}/?login_error=not_allowed`);
    expect((await googleLogin(base, googleProfile('a@example.com'), '/x', true)).location).toBe(`${STUDIO}/?login_error=failed`);
    const denied = await fetch(`${base}/auth/google/callback?error=access_denied`, { redirect: 'manual' });
    expect(denied.headers.get('location')).toBe(`${STUDIO}/?login_error=failed`);
  });
});

describe('cookie domain', () => {
  const expiredHostOnly = /^officexr\.sid=;(?!.*Domain=).*Expires=Thu, 01 Jan 1970/;
  const expiredDomain = /^officexr\.sid=;.*Domain=officexr\.test;.*Expires=Thu, 01 Jan 1970/;

  it('is set on the session cookie at login, which also expires the old host-only cookie', async () => {
    const base = await start('prod', { cookieDomain: 'officexr.test' });
    const cookies = (await googleLogin(base, googleProfile('a@example.com'))).callback.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies.some((c) => /^officexr\.sid=[^;]+;.*Domain=officexr\.test(;|$)/.test(c))).toBe(true);
    expect(cookies.some((c) => expiredHostOnly.test(c))).toBe(true);
  });

  it('is set on the clearing cookie at logout, which also expires the old host-only cookie', async () => {
    const base = await start('prod', { cookieDomain: 'officexr.test' });
    const { cookie } = await googleLogin(base, googleProfile('a@example.com'));
    const cookies = (await fetch(`${base}/auth/logout`, { method: 'POST', headers: { cookie: cookie! } })).headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies.some((c) => expiredDomain.test(c))).toBe(true);
    expect(cookies.some((c) => expiredHostOnly.test(c))).toBe(true);
  });

  it('is omitted when unset, with no host-only expiry', async () => {
    const base = await start('prod');
    const cookies = (await googleLogin(base, googleProfile('a@example.com'))).callback.headers.getSetCookie();
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).not.toMatch(/Domain=/);
  });
});

describe('createSessionReader', () => {
  it('resolves the identity from a cookie issued by createAuth, and null without one', async () => {
    const sessionStore = new session.MemoryStore();
    const base = await start('prod', { sessionStore });
    const { cookie } = await googleLogin(base, googleProfile('a@example.com', { name: 'Alice' }));
    const reader = createSessionReader({ sessionSecret: AUTH.sessionSecret, sessionStore, secure: false });
    const app = connect();
    reader.middlewares.forEach((middleware) => app.use(middleware));
    app.use((req, res) => {
      res.end(JSON.stringify(reader.sessionIdentity(req)));
    });
    const readerServer = createServer(app);
    await new Promise<void>((resolve) => readerServer.listen(0, resolve));
    try {
      const url = `http://127.0.0.1:${(readerServer.address() as AddressInfo).port}/anything`;
      expect(await (await fetch(url, { headers: { cookie: cookie! } })).json()).toEqual({ login: 'a@example.com', name: 'Alice' });
      expect(await (await fetch(url)).json()).toBeNull();
    } finally {
      readerServer.close();
    }
  });
});

describe('emailDomain', () => {
  it.each([
    ['c@allowed.org', 'allowed.org'],
    ['c@allowed.org.evil', 'allowed.org.evil'],
    ['c@sub.allowed.org', 'sub.allowed.org'],
    ['"a@allowed.org"@evil.com', 'evil.com'],
  ])('%s is at %s', (email, domain) => {
    expect(emailDomain(email)).toBe(domain);
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
    const base = await start('prod');
    expect(await (await fetch(`${base}/api/offices`)).json()).toEqual(offices);
  });

  it('returns one office, or 404', async () => {
    const base = await start('prod');
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
  const middleware = apiMiddleware({ ...apiDeps, createOffice: spyCreate, mapExists, identity: headerIdentity });

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
    const base = await start('prod');
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
  const middleware = apiMiddleware({ ...apiDeps, updateOffice: spyUpdate, mapExists: async (name) => name === 'hq' || name === 'default', identity: headerIdentity });

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
    const gone = apiMiddleware({ ...apiDeps, updateOffice: async () => undefined, mapExists: async () => true, identity: headerIdentity });
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
    const base = await start('prod');
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
    base = await start('prod', { studioDataDir });
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

  it('accepts a catalog character', async () => {
    expect((await put(ID, { characterId: NECROMANCER })).status).toBe(200);
    expect(await get(ID)).toBe(NECROMANCER);
  });

  it('rejects unknown characters and malformed bodies', async () => {
    expect((await put(ID, { characterId: 'Dragon' })).status).toBe(400);
    expect((await put(ID, { characterId: 'kaykit-skeletons/assets/gltf/Skeleton_Axe' })).status).toBe(400);
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

describe('/api/offices/:id/desk-claims', () => {
  let base: string;
  let me: Record<string, string>;
  let bob: Record<string, string>;
  const url = (officeId = ID, suffix = '') => `${base}/api/offices/${officeId}/desk-claims${suffix}`;
  const claim = (deskId: unknown, headers = me, officeId = ID) =>
    fetch(url(officeId, '/me'), { method: 'PUT', headers, body: JSON.stringify({ deskId }) });
  const list = async (headers = me) => (await (await fetch(url(), { headers })).json()).claims;
  beforeEach(async () => {
    claimsByOffice.clear();
    base = await start('prod', { realtimeTokenSecret: 's3cret', studioDataDir });
    me = await signIn(base, 'a@example.com');
    bob = await signIn(base, 'b@example.com');
  });

  it('claims, lists and moves a claim between desks', async () => {
    expect(await list()).toEqual({});
    const res = await claim('d1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ claims: { d1: 'a@example.com' } });
    expect(await (await claim('d2')).json()).toEqual({ claims: { d2: 'a@example.com' } });
    expect(await list(bob)).toEqual({ d2: 'a@example.com' });
  });

  it('is 409 for a desk another login holds, leaving the claims alone', async () => {
    await claim('d1');
    const res = await claim('d1', bob);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Desk taken' });
    expect(await list()).toEqual({ d1: 'a@example.com' });
  });

  it('is 200 when re-claiming the desk you already hold', async () => {
    await claim('d1');
    expect((await claim('d1')).status).toBe(200);
    expect(await list()).toEqual({ d1: 'a@example.com' });
  });

  it('validates against the default map for an office without one', async () => {
    expect((await claim('dd', me, OTHER)).status).toBe(200);
    expect((await claim('d1', me, OTHER)).status).toBe(400);
  });

  it('is 413 for an oversized body', async () => {
    const res = await fetch(url(ID, '/me'), { method: 'PUT', headers: me, body: JSON.stringify({ deskId: 'd1', pad: 'x'.repeat(5000) }) });
    expect(res.status).toBe(413);
  });

  it('is 400 for desks not on the office map', async () => {
    for (const deskId of ['nope', '', 1, undefined]) {
      const res = await claim(deskId);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Unknown desk' });
    }
    expect(await list()).toEqual({});
  });

  it('releases idempotently', async () => {
    await claim('d1');
    for (let i = 0; i < 2; i++) {
      const res = await fetch(url(ID, '/me'), { method: 'DELETE', headers: me });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ claims: {} });
    }
  });

  it('is 401 without identity and 404 for unknown offices', async () => {
    expect((await fetch(url())).status).toBe(401);
    expect((await fetch(url(ID, '/me'), { method: 'DELETE' })).status).toBe(401);
    expect((await fetch(url('22222222-2222-4222-8222-222222222222'), { headers: me })).status).toBe(404);
  });

  it('is 405 for other methods', async () => {
    expect((await fetch(url(), { method: 'PUT', headers: me, body: '{}' })).status).toBe(405);
    expect((await fetch(url(ID, '/me'), { headers: me })).status).toBe(405);
  });

  it('works with a bearer api token', async () => {
    const token = signJoinToken('s3cret', { login: 'rt@example.com', ttlMs: 60_000, aud: 'api' });
    const headers = { authorization: `Bearer ${token}` };
    expect((await claim('d1', headers)).status).toBe(200);
    expect(await list(headers)).toEqual({ d1: 'rt@example.com' });
    const released = await fetch(url(ID, '/me'), { method: 'DELETE', headers });
    expect(released.status).toBe(200);
    expect(await released.json()).toEqual({ claims: {} });
  });
});

describe('studio storage', () => {
  it('serves maps read-only', async () => {
    const base = await start('prod');
    expect((await fetch(`${base}/api/maps/default`)).status).toBe(200);
    for (const method of ['PUT', 'DELETE']) {
      expect((await fetch(`${base}/api/maps/default`, { method, body: method === 'PUT' ? '{}' : undefined })).status).toBe(405);
      expect((await fetch(`${base}/api/world-object-kinds`, { method })).status).toBe(405);
    }
  });
});

describe('/models', () => {
  it('serves model files and 404s outside the models dir', async () => {
    const base = await start('prod');
    const res = await fetch(`${base}/models/characters/Mage.glb`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('model/gltf-binary');
    expect(await res.text()).toBe('glb');
  });

  it('404s paths that escape the models dir', async () => {
    const base = await start('prod');
    expect(await rawStatus(base, `/models/..%2f${outsideName}`)).toBe(404);
    expect(await rawStatus(base, `/models/characters/..%2f..%2f${outsideName}`)).toBe(404);
  });

  it('400s malformed escapes and keeps serving', async () => {
    const base = await start('prod');
    expect(await rawStatus(base, '/models/%E0%A4%A')).toBe(400);
    expect((await fetch(`${base}/models/characters/Mage.glb`)).status).toBe(200);
  });
});

describe('/config.js', () => {
  it('serves OFFICEXR_ASSET_BASE_URL from the environment', async () => {
    process.env.OFFICEXR_ASSET_BASE_URL = 'https://cdn.example.com';
    try {
      const base = await start('prod');
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
      const base = await start('prod');
      const body = await (await fetch(`${base}/config.js`)).text();
      expect(body).not.toContain('google-secret');
      expect(body).not.toContain('session-secret');
    } finally {
      delete process.env.GOOGLE_CLIENT_SECRET;
      delete process.env.SESSION_SECRET;
    }
  });

  it('never serves the JaaS private key or API key id, even when set (old or new names)', async () => {
    const secrets = {
      VITE_JAAS_PRIVATE_KEY: 'legacy-private-key',
      OFFICEXR_JAAS_PRIVATE_KEY: 'server-private-key',
      VITE_JAAS_API_KEY_ID: 'legacy-key-id',
      OFFICEXR_JAAS_API_KEY_ID: 'server-key-id',
      VITE_JAAS_APP_ID: 'vpaas-magic-cookie-public',
    };
    Object.assign(process.env, secrets);
    try {
      for (const mode of ['prod', 'dev'] as const) {
        const base = await start(mode, mode === 'dev' ? { devUser: { login: 'dev@example.com', name: 'Dev' }, auth: {} } : {});
        const body = await (await fetch(`${base}/config.js`)).text();
        for (const secret of ['legacy-private-key', 'server-private-key', 'legacy-key-id', 'server-key-id']) {
          expect(body).not.toContain(secret);
        }
        expect(body).not.toContain('PRIVATE_KEY');
        expect(body).toContain('"VITE_JAAS_APP_ID":"vpaas-magic-cookie-public"');
        server?.close();
      }
    } finally {
      for (const key of Object.keys(secrets)) {
        delete process.env[key];
      }
    }
  });
});

describe('createApp routing', () => {
  it('serves realtime /health and /rooms; GET / is 404', async () => {
    const base = await start('prod');
    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true });
    expect(await (await fetch(`${base}/rooms/${ID}/sessions?login=a@example.com`)).json()).toEqual({ connected: false, allowMulti: false });
    expect((await fetch(`${base}/api/nope`)).status).toBe(404);
    expect((await fetch(`${base}/`)).status).toBe(404);
  });
});
