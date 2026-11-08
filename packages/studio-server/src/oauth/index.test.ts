import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import connect from 'connect';
import session from 'express-session';
import { createSessionReader } from '@officexr/server';
import { loopbackOrigin } from '@officexr/studio-mcp/mount-mcp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signIn as signInAs } from '../test-sign-in.ts';
import { createOAuthApp, parseOAuthEnv } from './index.ts';
import { InMemoryOAuthStore } from './store.ts';

const ISSUER = 'https://studio-api.example.com';
const RESOURCE = `${ISSUER}/mcp`;
const WEB = 'https://web.example.com';
const REDIRECT = 'https://client.example.com/callback';
const SECRET = 'test-secret';
const ADMIN = 'admin@example.com';
const HOUR_MS = 3_600_000;

let clock: Date;
let admins: Set<string>;
let sessionStore: session.MemoryStore;
let oauth: ReturnType<typeof createOAuthApp>;
let server: Server;
let origin: string;

beforeEach(async () => {
  clock = new Date();
  admins = new Set([ADMIN]);
  sessionStore = new session.MemoryStore();
  const now = () => clock;
  oauth = createOAuthApp({ store: new InMemoryOAuthStore(now), isAdmin: async (login) => admins.has(login), issuerUrl: ISSUER, webPublicUrl: WEB, now });
  const app = connect();
  createSessionReader({ sessionSecret: SECRET, sessionStore, secure: false }).middlewares.forEach((middleware) => app.use(middleware));
  app.use(oauth.handler);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = loopbackOrigin(server);
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const signIn = (login: string) => signInAs(sessionStore, SECRET, login);

async function register(metadata: Record<string, unknown> = { token_endpoint_auth_method: 'none' }) {
  const res = await fetch(`${origin}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ redirect_uris: [REDIRECT], client_name: 'Test <b>client</b>', ...metadata }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { client_id: string; client_secret?: string };
}

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

function authorizeUrl(clientId: string, challenge: string, resource: string | null = RESOURCE) {
  const url = new URL('/authorize', origin);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'xyz',
    ...(resource === null ? {} : { resource }),
  }).toString();
  return url.href;
}

const get = (url: string, cookie?: string) => fetch(url, { redirect: 'manual', headers: cookie ? { cookie } : {} });

const postForm = (path: string, fields: Record<string, string>, cookie?: string) =>
  fetch(`${origin}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) },
    body: new URLSearchParams(fields).toString(),
  });

/** Opens the consent page as `login` and returns its CSRF token. */
async function consentToken(clientId: string, challenge: string, cookie: string) {
  const res = await get(authorizeUrl(clientId, challenge), cookie);
  expect(res.status).toBe(200);
  return (await res.text()).match(/name="csrf_token" value="([^"]+)"/)![1];
}

/** Registers a client and runs authorize and consent as the admin; returns the code and its PKCE verifier. */
async function authorizedCode(metadata?: Record<string, unknown>) {
  const client = await register(metadata);
  const { verifier, challenge } = pkce();
  const cookie = await signIn(ADMIN);
  const res = await postForm('/authorize/consent', { csrf_token: await consentToken(client.client_id, challenge, cookie) }, cookie);
  expect(res.status).toBe(302);
  const location = new URL(res.headers.get('location')!);
  expect(location.origin + location.pathname).toBe(REDIRECT);
  expect(location.searchParams.get('state')).toBe('xyz');
  return { client, verifier, code: location.searchParams.get('code')! };
}

const exchangeCode = (clientId: string, code: string, verifier: string, extra: Record<string, string> = {}) =>
  postForm('/token', { grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: REDIRECT, ...extra });

describe('MCP OAuth server', () => {
  it('serves metadata naming STUDIO_PUBLIC_URL as the issuer, without a session', async () => {
    const res = await get(`${origin}/.well-known/oauth-authorization-server`);
    expect(res.status).toBe(200);
    const metadata = await res.json();
    expect(metadata.issuer).toBe(`${ISSUER}/`);
    expect(metadata.code_challenge_methods_supported).toEqual(['S256']);
  });

  it('registers clients dynamically', async () => {
    const client = await register();
    expect(client.client_id).toBeTruthy();
    expect(client.client_secret).toBeUndefined();
  });

  it('rejects a missing or different resource back to the client', async () => {
    const { client_id } = await register();
    const cookie = await signIn(ADMIN);
    for (const resource of [null, `${ISSUER}/other`, `${RESOURCE}/`]) {
      const res = await get(authorizeUrl(client_id, pkce().challenge, resource), cookie);
      expect(res.status).toBe(302);
      const location = new URL(res.headers.get('location')!);
      expect(location.searchParams.get('error')).toBe('invalid_target');
      expect(location.searchParams.get('code')).toBeNull();
    }
  });

  it('sends a request without a session to the web sign-in, returning to the same /authorize URL', async () => {
    const { client_id } = await register();
    const url = authorizeUrl(client_id, pkce().challenge);
    const res = await get(url);
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(`${WEB}/auth/google`);
    const next = new URL(location.searchParams.get('next')!);
    expect(next.origin).toBe(ISSUER);
    expect(next.pathname + next.search).toBe(new URL(url).pathname + new URL(url).search);
  });

  it('answers 401 rather than a sign-in redirect for a POST without a session, which would lose its params', async () => {
    const { client_id } = await register();
    const res = await postForm('/authorize', {
      response_type: 'code',
      client_id,
      redirect_uri: REDIRECT,
      code_challenge: pkce().challenge,
      code_challenge_method: 'S256',
      resource: RESOURCE,
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('location')).toBeNull();
  });

  it('answers 400 without redirecting for an unregistered redirect_uri', async () => {
    const { client_id } = await register();
    const url = new URL(authorizeUrl(client_id, pkce().challenge));
    url.searchParams.set('redirect_uri', 'https://evil.example.com/callback');
    const res = await get(url.href, await signIn(ADMIN));
    expect(res.status).toBe(400);
    expect(res.headers.get('location')).toBeNull();
  });

  it('answers 403 and issues nothing for a signed-in non-admin', async () => {
    const { client_id } = await register();
    const res = await get(authorizeUrl(client_id, pkce().challenge), await signIn('someone@example.com'));
    expect(res.status).toBe(403);
    expect(res.headers.get('location')).toBeNull();
    expect(await res.text()).not.toContain('csrf_token');
  });

  it('names the client on an escaped consent page that cannot be framed', async () => {
    const { client_id } = await register();
    const res = await get(authorizeUrl(client_id, pkce().challenge), await signIn(ADMIN));
    const html = await res.text();
    expect(html).toContain('Test &lt;b&gt;client&lt;/b&gt;');
    expect(html).toContain(REDIRECT);
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });

  it('issues a code after consent and exchanges it once, with PKCE, for tokens carrying the admin and resource', async () => {
    const { client, verifier, code } = await authorizedCode();
    expect((await exchangeCode(client.client_id, code, 'wrong'.repeat(10))).status).toBe(400);

    const second = await authorizedCode();
    const res = await exchangeCode(second.client.client_id, second.code, second.verifier);
    expect(res.status).toBe(200);
    const tokens = await res.json();
    expect(tokens).toMatchObject({ token_type: 'Bearer', expires_in: 3600 });
    const auth = await oauth.verifyAccessToken(tokens.access_token);
    expect(auth).toMatchObject({ clientId: second.client.client_id, extra: { login: ADMIN } });
    expect(auth.resource?.href).toBe(RESOURCE);

    const reused = await exchangeCode(second.client.client_id, second.code, second.verifier);
    expect(reused.status).toBe(400);
    expect((await reused.json()).error).toBe('invalid_grant');
    // A code whose PKCE check failed is spent too.
    expect((await exchangeCode(client.client_id, code, verifier)).status).toBe(400);
  });

  it('rejects a forged, reused or another login’s consent token', async () => {
    const { client_id } = await register();
    const cookie = await signIn(ADMIN);
    expect((await postForm('/authorize/consent', { csrf_token: 'forged' }, cookie)).status).toBe(403);

    const token = await consentToken(client_id, pkce().challenge, cookie);
    admins.add('other@example.com');
    expect((await postForm('/authorize/consent', { csrf_token: token }, await signIn('other@example.com'))).status).toBe(403);
    // The failed attempt spent it.
    expect((await postForm('/authorize/consent', { csrf_token: token }, cookie)).status).toBe(403);

    const fresh = await consentToken(client_id, pkce().challenge, cookie);
    expect((await postForm('/authorize/consent', { csrf_token: fresh }, cookie)).status).toBe(302);
    expect((await postForm('/authorize/consent', { csrf_token: fresh }, cookie)).status).toBe(403);
  });

  it('rejects a consent token after it expires', async () => {
    const { client_id } = await register();
    const cookie = await signIn(ADMIN);
    const token = await consentToken(client_id, pkce().challenge, cookie);
    clock = new Date(clock.getTime() + 11 * 60_000);
    expect((await postForm('/authorize/consent', { csrf_token: token }, cookie)).status).toBe(403);
  });

  it('rotates refresh tokens, refusing a spent one', async () => {
    const { client, verifier, code } = await authorizedCode();
    const first = await (await exchangeCode(client.client_id, code, verifier)).json();
    const refresh = (token: string) => postForm('/token', { grant_type: 'refresh_token', client_id: client.client_id, refresh_token: token });

    const res = await refresh(first.refresh_token);
    expect(res.status).toBe(200);
    const second = await res.json();
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect((await oauth.verifyAccessToken(second.access_token)).resource?.href).toBe(RESOURCE);

    expect((await refresh(first.refresh_token)).status).toBe(400);
    const racing = await Promise.all([refresh(second.refresh_token), refresh(second.refresh_token)]);
    expect(racing.map((r) => r.status).sort()).toEqual([200, 400]);
  });

  it('refuses to exchange a code or refresh token once the login left the admin allowlist', async () => {
    const pending = await authorizedCode();
    const issued = await authorizedCode();
    const { refresh_token } = await (await exchangeCode(issued.client.client_id, issued.code, issued.verifier)).json();
    const refresh = () => postForm('/token', { grant_type: 'refresh_token', client_id: issued.client.client_id, refresh_token });

    admins.delete(ADMIN);
    expect((await (await exchangeCode(pending.client.client_id, pending.code, pending.verifier)).json()).error).toBe('invalid_grant');
    expect((await (await refresh()).json()).error).toBe('invalid_grant');
    admins.add(ADMIN);
    expect((await refresh()).status).toBe(400);
  });

  it('refuses another client’s code or refresh token, and ignores its revocation', async () => {
    const { client, verifier, code } = await authorizedCode();
    const other = await register();
    expect((await exchangeCode(other.client_id, code, verifier)).status).toBe(400);

    const second = await authorizedCode();
    const { access_token, refresh_token } = await (await exchangeCode(second.client.client_id, second.code, second.verifier)).json();
    const refresh = (clientId: string) => postForm('/token', { grant_type: 'refresh_token', client_id: clientId, refresh_token });
    expect((await refresh(other.client_id)).status).toBe(400);

    expect((await postForm('/revoke', { client_id: other.client_id, token: access_token })).status).toBe(200);
    await oauth.verifyAccessToken(access_token);
    expect((await refresh(second.client.client_id)).status).toBe(200);
    // The store can't read a code without consuming it, so another client's attempt spends it.
    expect((await exchangeCode(client.client_id, code, verifier)).status).toBe(400);
  });

  it('rejects an expired access token and one whose login left the admin allowlist', async () => {
    const { client, verifier, code } = await authorizedCode();
    const { access_token } = await (await exchangeCode(client.client_id, code, verifier)).json();
    await oauth.verifyAccessToken(access_token);

    admins.delete(ADMIN);
    await expect(oauth.verifyAccessToken(access_token)).rejects.toThrow('Not an admin');
    admins.add(ADMIN);

    clock = new Date(clock.getTime() + HOUR_MS + 1);
    await expect(oauth.verifyAccessToken(access_token)).rejects.toThrow('Invalid access token');
  });

  it('checks a confidential client’s secret on the token and revoke endpoints', async () => {
    const { client, verifier, code } = await authorizedCode({ token_endpoint_auth_method: 'client_secret_post' });
    expect(client.client_secret).toBeTruthy();

    for (const fields of [{}, { client_secret: 'wrong' }] as Record<string, string>[]) {
      const res = await exchangeCode(client.client_id, code, verifier, fields);
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe('invalid_client');
    }
    const res = await exchangeCode(client.client_id, code, verifier, { client_secret: client.client_secret! });
    expect(res.status).toBe(200);
    const { access_token } = await res.json();

    const revoke = (fields: Record<string, string>) => postForm('/revoke', { client_id: client.client_id, token: access_token, ...fields });
    expect((await revoke({ client_secret: 'wrong' })).status).toBe(401);
    await oauth.verifyAccessToken(access_token);
    expect((await revoke({ client_secret: client.client_secret! })).status).toBe(200);
    await expect(oauth.verifyAccessToken(access_token)).rejects.toThrow('Invalid access token');
  });
});

describe('parseOAuthEnv', () => {
  it('enables the server only with both URLs, each normalized to a plain origin', () => {
    expect(parseOAuthEnv({})).toEqual({ type: 'disabled' });
    expect(parseOAuthEnv({ STUDIO_PUBLIC_URL: ISSUER, OFFICEXR_WEB_PUBLIC_URL: WEB })).toEqual({ type: 'enabled', issuerUrl: ISSUER, webPublicUrl: WEB });
    expect(parseOAuthEnv({ STUDIO_PUBLIC_URL: ISSUER }).type).toBe('invalid');
    expect(parseOAuthEnv({ OFFICEXR_WEB_PUBLIC_URL: WEB }).type).toBe('invalid');
    for (const loose of [`${ISSUER}/`, ` ${ISSUER}\n`]) {
      expect(parseOAuthEnv({ STUDIO_PUBLIC_URL: loose, OFFICEXR_WEB_PUBLIC_URL: `${WEB}/\n` })).toEqual({ type: 'enabled', issuerUrl: ISSUER, webPublicUrl: WEB });
    }
    for (const bad of [`${ISSUER}/api`, `${ISSUER}?x=1`, `${ISSUER}#x`, 'studio-api.example.com']) {
      expect(parseOAuthEnv({ STUDIO_PUBLIC_URL: bad, OFFICEXR_WEB_PUBLIC_URL: WEB })).toMatchObject({ type: 'invalid', problem: expect.stringContaining('STUDIO_PUBLIC_URL') });
      expect(parseOAuthEnv({ STUDIO_PUBLIC_URL: ISSUER, OFFICEXR_WEB_PUBLIC_URL: bad.replace(ISSUER, WEB) })).toMatchObject({
        type: 'invalid',
        problem: expect.stringContaining('OFFICEXR_WEB_PUBLIC_URL'),
      });
    }
  });
});
