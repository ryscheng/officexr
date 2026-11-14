import { ServerResponse, type IncomingMessage } from 'node:http';
import type { NextHandleFunction } from 'connect';
import { isAllowedOrigin, type createSessionReader } from '@officexr/server';
import { PREVIEW_TOKEN_PARAM } from '@officexr/server/preview-token';
import type { Identity } from '@officexr/server/shared';
import { assertNever, pathname } from './http.ts';

export type IsAllowed = (login: string) => Promise<boolean>;
type SessionReader = ReturnType<typeof createSessionReader>;

export type VerifyApiToken = (token: string) => Promise<{ login: string } | null>;
/** `PreviewTokens.verify`: the web backend's stand-in for its session cookie on frontends the cookie can't reach. */
export type VerifyPreviewToken = (token: string) => Promise<Identity | null>;

/** Where a request's identity came from: the session cookie (possibly absent) or a verified bearer token. */
type Source = { type: 'session'; identity: Identity | null } | { type: 'bearer'; identity: Identity };

export type Access = { type: 'allowed'; identity: Identity } | { type: 'denied'; status: 401 | 403; error: string; challenge?: 'invalid_token' };

/** Remembers each login's answer for `ttlMs`; a failed lookup is not remembered. */
export function cacheAllowlist(isAllowed: IsAllowed, ttlMs = 60_000, now = Date.now): IsAllowed {
  // ponytail: allowlist changes, additions and removals alike, take up to ttlMs to apply.
  const answers = new Map<string, { allowed: boolean; expires: number }>();
  return async (login) => {
    const cached = answers.get(login);
    if (cached && cached.expires > now()) {
      return cached.allowed;
    }
    const allowed = await isAllowed(login);
    answers.set(login, { allowed, expires: now() + ttlMs });
    return allowed;
  };
}

async function access(source: Source, isStudioAllowed: IsAllowed, isAdmin?: IsAllowed): Promise<Access> {
  const { identity } = source;
  if (!identity) {
    return { type: 'denied', status: 401, error: 'Not signed in' };
  }
  const allowed =
    source.type === 'session'
      ? await isStudioAllowed(identity.login)
      : source.type === 'bearer'
        ? (await isStudioAllowed(identity.login)) && !!isAdmin && (await isAdmin(identity.login))
        : assertNever(source);
  return allowed ? { type: 'allowed', identity } : { type: 'denied', status: 403, error: 'Not allowed' };
}

const isUnder = (path: string | undefined, prefix: string) => path === prefix || !!path?.startsWith(`${prefix}/`);
// Express matches routes case-insensitively and ignores a trailing slash.
const isApprovalRoute = (path: string | undefined) => isUnder(path?.toLowerCase().replace(/\/+$/, ''), '/api/agent-token-requests');
const bearerToken = (req: IncomingMessage) => /^Bearer\s+(\S+)\s*$/i.exec(req.headers.authorization ?? '')?.[1];

export function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

/**
 * Mount after the session reader's middlewares. Answers `GET /api/me` itself, refuses every request without an
 * allowed identity, and passes allowed ones on; a failed allowlist lookup goes to the error handler.
 * A Bearer preview token stands in for the session cookie, as its user. Any other Bearer on `/api/*` must be a studio
 * API token, whose callers must be on both the studio and admin allowlists.
 */
export function studioGate(
  reader: SessionReader,
  isStudioAllowed: IsAllowed,
  isAdmin: IsAllowed,
  verifyApiToken?: VerifyApiToken,
  verifyPreviewToken?: VerifyPreviewToken,
): NextHandleFunction {
  const identify = async (req: IncomingMessage): Promise<Source | Extract<Access, { type: 'denied' }>> => {
    const path = pathname(req);
    const bearer = bearerToken(req);
    const preview = bearer === undefined ? null : await verifyPreviewToken?.(bearer);
    if (preview) {
      // So routes that read the session user, like the token approvals, act for the preview token's user.
      (req as { user?: Identity }).user = preview;
      return { type: 'session', identity: preview };
    }
    const token = isUnder(path, '/api') ? bearer : undefined;
    if (token === undefined) {
      return { type: 'session', identity: reader.sessionIdentity(req) };
    }
    const verified = await verifyApiToken?.(token);
    if (!verified) {
      return { type: 'denied', status: 401, error: 'Invalid token', challenge: 'invalid_token' };
    }
    return isApprovalRoute(path)
      ? { type: 'denied', status: 403, error: 'Not allowed' }
      : { type: 'bearer', identity: { login: verified.login, name: verified.login } };
  };
  return (req, res, next) => {
    identify(req)
      .then((found) => (found.type === 'denied' ? found : access(found, isStudioAllowed, isAdmin)))
      .then((result) => {
        if (result.type === 'denied') {
          if (result.challenge) {
            res.setHeader('WWW-Authenticate', `Bearer error="${result.challenge}"`);
          }
          sendJson(res, result.status, { error: result.error });
        } else if (req.method === 'GET' && pathname(req) === '/api/me') {
          sendJson(res, 200, { login: result.identity.login, name: result.identity.name });
        } else {
          next();
        }
      }, next);
  };
}

/** `url` without its preview token, so the token isn't forwarded upstream. */
export function withoutPreviewToken(url: string): string {
  const parsed = new URL(url, 'http://localhost');
  parsed.searchParams.delete(PREVIEW_TOKEN_PARAM);
  return `${parsed.pathname}${parsed.search}`;
}

/**
 * The same check for a WebSocket upgrade, which never reaches the app's middleware stack. CORS doesn't cover
 * WebSockets and the cookie rides on handshakes from any same-site page, so a foreign `Origin` is refused first.
 */
export function upgradeAccess(reader: SessionReader, isStudioAllowed: IsAllowed, frontendOrigins: string[], verifyPreviewToken?: VerifyPreviewToken) {
  return async (req: IncomingMessage): Promise<Access> => {
    const origin = req.headers.origin;
    if (frontendOrigins.length && origin !== undefined && !isAllowedOrigin(origin, frontendOrigins)) {
      return { type: 'denied', status: 403, error: 'Origin not allowed' };
    }
    // Browsers can't set headers on a WebSocket handshake, so a preview token comes in the query string.
    const token = new URL(req.url ?? '/', 'http://localhost').searchParams.get(PREVIEW_TOKEN_PARAM);
    const preview = token === null ? null : await verifyPreviewToken?.(token);
    if (preview) {
      return access({ type: 'session', identity: preview }, isStudioAllowed);
    }
    // The session middlewares only read from the response here: the session is never modified, so nothing is written.
    const res = new ServerResponse(req);
    for (const middleware of reader.middlewares) {
      await new Promise<void>((resolve, reject) => middleware(req, res, (err?: unknown) => (err ? reject(err) : resolve())));
    }
    return access({ type: 'session', identity: reader.sessionIdentity(req) }, isStudioAllowed);
  };
}
