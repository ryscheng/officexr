import type { NextHandleFunction } from 'connect';
import express, { type RequestHandler } from 'express';
import { sessionIdentity } from '@officexr/server';
import { InvalidClientError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { pathname } from '../http.ts';
import type { IsAllowed } from '../studio-gate.ts';
import { sendForbidden } from './consent.ts';
import { AdminOAuthProvider } from './provider.ts';
import type { OAuthStore } from './store.ts';

export type OAuthEnv =
  | { type: 'disabled' }
  | { type: 'enabled'; issuerUrl: string; webPublicUrl: string }
  | { type: 'invalid'; missing: string };

/** The MCP OAuth server runs only when both `STUDIO_PUBLIC_URL` and `OFFICEXR_WEB_PUBLIC_URL` are set. */
export function parseOAuthEnv(env: Record<string, string | undefined>): OAuthEnv {
  const issuerUrl = env.STUDIO_PUBLIC_URL;
  const webPublicUrl = env.OFFICEXR_WEB_PUBLIC_URL;
  if (issuerUrl && webPublicUrl) {
    return { type: 'enabled', issuerUrl, webPublicUrl };
  }
  if (issuerUrl || webPublicUrl) {
    return { type: 'invalid', missing: issuerUrl ? 'OFFICEXR_WEB_PUBLIC_URL' : 'STUDIO_PUBLIC_URL' };
  }
  return { type: 'disabled' };
}

/**
 * The SDK's client authentication compares `client_secret` with the stored client's, which `OAuthStore.getClient`
 * never returns, so it would let any caller act as a confidential client. Like the SDK's registration handler, a
 * client registered with `token_endpoint_auth_method: none` is public and every other client is confidential.
 */
function requireClientSecret(store: OAuthStore): RequestHandler {
  return async (req, res, next) => {
    const { client_id: clientId, client_secret: secret } = (req.body ?? {}) as Record<string, unknown>;
    const client = req.method === 'POST' && typeof clientId === 'string' ? await store.getClient(clientId) : null;
    if (
      client &&
      client.token_endpoint_auth_method !== 'none' &&
      !(typeof secret === 'string' && (await store.verifyClientSecret(client.client_id, secret)))
    ) {
      res.status(401).json(new InvalidClientError('Invalid client_secret').toResponseObject());
      return;
    }
    next();
  };
}

/**
 * Mount after the session reader's middlewares; other paths pass straight through. `verifyAccessToken` re-checks
 * `isAdmin` on every call and reports the login as `extra.login` and the audience as `resource`.
 */
export function createOAuthApp(opts: {
  store: OAuthStore;
  isAdmin: IsAllowed;
  /** `STUDIO_PUBLIC_URL`. */
  issuerUrl: string;
  /** The web backend's `PUBLIC_URL`, where `/auth/google` signs users in. */
  webPublicUrl: string;
  now?: () => Date;
}): { handler: NextHandleFunction; verifyAccessToken: (token: string) => Promise<AuthInfo> } {
  const issuerUrl = new URL(opts.issuerUrl);
  const resource = new URL('/mcp', issuerUrl);
  const provider = new AdminOAuthProvider(opts.store, opts.isAdmin, new URL('/auth/google', opts.webPublicUrl), resource, opts.now);

  const app = express();
  app.disable('x-powered-by');
  // Behind the Cloudflare tunnel, so the SDK's rate limits key on the client's address rather than the tunnel's.
  app.set('trust proxy', 1);
  app.post('/authorize/consent', express.urlencoded({ extended: false }), async (req, res) => {
    const identity = sessionIdentity(req);
    const csrfToken: unknown = req.body?.csrf_token;
    const location = identity && typeof csrfToken === 'string' ? await provider.approve(csrfToken, identity.login) : null;
    if (location) {
      res.redirect(302, location);
    } else {
      sendForbidden(res, 'This authorization request is invalid or has expired. Start again from your MCP client.');
    }
  });
  app.use(['/token', '/revoke'], express.urlencoded({ extended: false }), requireClientSecret(opts.store));
  app.use(mcpAuthRouter({ provider, issuerUrl, resourceServerUrl: resource }));

  // Express swaps the prototypes of every request it handles, so only OAuth requests are handed to it.
  const paths = new Set([
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-protected-resource/mcp',
    '/authorize',
    '/authorize/consent',
    '/token',
    '/register',
    '/revoke',
  ]);
  return {
    handler: (req, res, next) => (paths.has(pathname(req) ?? '') ? app(req as express.Request, res as express.Response, next) : next()),
    verifyAccessToken: (token) => provider.verifyAccessToken(token),
  };
}
