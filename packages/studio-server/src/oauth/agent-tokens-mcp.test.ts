import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import connect from 'connect';
import session from 'express-session';
import { createSessionReader } from '@officexr/server';
import type { AgentTokens } from '@officexr/studio-mcp/agent-tokens';
import { createStudioMcpOptions, loopbackOrigin, mcpMethodGuard, mcpPostHandler } from '@officexr/studio-mcp/mount-mcp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signIn } from '../test-sign-in.ts';
import { createOAuthApp } from './index.ts';
import { InMemoryOAuthStore } from './store.ts';

const ISSUER = 'https://studio-api.example.com';
const SECRET = 'test-secret';
const REDIRECT = 'https://client.example.com/callback';
const LOGIN = 'alice@example.com';

let server: Server;
let origin: string;
let sessionStore: session.MemoryStore;
let requests: unknown[][];

beforeEach(async () => {
  sessionStore = new session.MemoryStore();
  requests = [];
  const agentTokens: AgentTokens = {
    request: async (login, input) => {
      requests.push([login, input]);
      return { requestId: 'r1', approvalUrl: 'https://app/approve/r1', expiresAt: 'x' };
    },
    poll: async () => ({ status: 'denied' }),
    listPending: async () => [],
    approve: async () => {},
    deny: async () => {},
  };
  const mcpOptions = { ...createStudioMcpOptions({ modelRoot: '/nonexistent' }), agentTokens, origin: () => origin };
  const oauth = createOAuthApp({
    store: new InMemoryOAuthStore(),
    isAdmin: async () => true,
    issuerUrl: ISSUER,
    webPublicUrl: 'https://web.example.com',
    mcp: (req, res, next) => mcpMethodGuard(req, res, () => void mcpPostHandler(mcpOptions)(req, res, next)),
  });
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

const form = (path: string, fields: Record<string, string>, cookie?: string) =>
  fetch(`${origin}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) },
    body: new URLSearchParams(fields).toString(),
  });

async function accessTokenFor(login: string) {
  const registered = await fetch(`${origin}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' }),
  });
  const clientId = ((await registered.json()) as { client_id: string }).client_id;
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const cookie = await signIn(sessionStore, SECRET, login);
  const authorize = new URL('/authorize', origin);
  authorize.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'xyz',
    resource: `${ISSUER}/mcp`,
  }).toString();
  const page = await (await fetch(authorize, { headers: { cookie } })).text();
  const csrf = page.match(/name="csrf_token" value="([^"]+)"/)![1];
  const consent = await form('/authorize/consent', { csrf_token: csrf }, cookie);
  const code = new URL(consent.headers.get('location')!).searchParams.get('code')!;
  const tokens = await form('/token', { grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: REDIRECT });
  return { clientId, accessToken: ((await tokens.json()) as { access_token: string }).access_token };
}

const callTool = (accessToken: string, name: string, args: Record<string, unknown>) =>
  fetch(`${origin}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });

describe('agent token tools on the OAuth-protected /mcp', () => {
  it('creates the request for the access token’s login and client', async () => {
    const { clientId, accessToken } = await accessTokenFor(LOGIN);
    const res = await callTool(accessToken, 'request_api_token', { purpose: 'bake a layout' });
    expect(res.status).toBe(200);
    const result = ((await res.json()) as { result: { isError?: boolean; content: { text: string }[] } }).result;
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text).requestId).toBe('r1');
    expect(requests).toEqual([[LOGIN, { purpose: 'bake a layout', clientId }]]);
  });

  it('is unreachable without a bearer token', async () => {
    expect((await callTool('nope', 'request_api_token', { purpose: 'x' })).status).toBe(401);
    expect(requests).toEqual([]);
  });
});
