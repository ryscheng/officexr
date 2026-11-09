import { ServerResponse, type IncomingMessage } from 'node:http';
import type { NextHandleFunction } from 'connect';
import type { createSessionReader } from '@officexr/server';
import type { Identity } from '@officexr/server/shared';
import { pathname } from './http.ts';

export type IsAllowed = (login: string) => Promise<boolean>;
type SessionReader = ReturnType<typeof createSessionReader>;

export type VerifyApiToken = (token: string) => Promise<{ login: string } | null>;

/** Where a request's identity came from: the session cookie (possibly absent) or a verified bearer token. */
type Source = { type: 'session'; identity: Identity | null } | { type: 'bearer'; identity: Identity };

const assertNever = (value: never): never => {
  throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
};

export type Access = { type: 'allowed'; identity: Identity } | { type: 'denied'; status: 401 | 403; error: string };

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

async function access(source: Source, isStudioAllowed: IsAllowed, isAdmin: IsAllowed): Promise<Access> {
  const { identity } = source;
  if (!identity) {
    return { type: 'denied', status: 401, error: 'Not signed in' };
  }
  const allowed =
    source.type === 'session'
      ? await isStudioAllowed(identity.login)
      : source.type === 'bearer'
        ? (await isStudioAllowed(identity.login)) && (await isAdmin(identity.login))
        : assertNever(source);
  return allowed ? { type: 'allowed', identity } : { type: 'denied', status: 403, error: 'Not allowed' };
}

const isUnder = (path: string | undefined, prefix: string) => path === prefix || !!path?.startsWith(`${prefix}/`);
const bearerToken = (req: IncomingMessage) => /^Bearer\s+(\S+)\s*$/i.exec(req.headers.authorization ?? '')?.[1];

export function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

/**
 * Mount after the session reader's middlewares. Answers `GET /api/me` itself, refuses every request without an
 * allowed identity, and passes allowed ones on; a failed allowlist lookup goes to the error handler.
 * On `/api/*` an `Authorization: Bearer` studio API token acts as its user (never falling back to the cookie),
 * provided the user is also an admin; without `verifyApiToken` any bearer header is refused. The `Authorization`
 * header is ignored elsewhere. Bearer requests can't reach the token approval routes.
 */
export function studioGate(reader: SessionReader, isStudioAllowed: IsAllowed, isAdmin: IsAllowed, verifyApiToken?: VerifyApiToken): NextHandleFunction {
  const identify = async (req: IncomingMessage): Promise<Source | Extract<Access, { type: 'denied' }>> => {
    const token = isUnder(pathname(req), '/api') ? bearerToken(req) : undefined;
    if (token === undefined) {
      return { type: 'session', identity: reader.sessionIdentity(req) };
    }
    const verified = await verifyApiToken?.(token);
    if (!verified) {
      return { type: 'denied', status: 401, error: 'Invalid token' };
    }
    return isUnder(pathname(req), '/api/agent-token-requests')
      ? { type: 'denied', status: 403, error: 'Not allowed' }
      : { type: 'bearer', identity: { login: verified.login, name: verified.login } };
  };
  return (req, res, next) => {
    identify(req)
      .then((found) => (found.type === 'denied' ? found : access(found, isStudioAllowed, isAdmin)))
      .then((result) => {
        if (result.type === 'denied') {
          if (result.error === 'Invalid token') {
            res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
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

/**
 * The same check for a WebSocket upgrade, which never reaches the app's middleware stack. CORS doesn't cover
 * WebSockets and the cookie rides on handshakes from any same-site page, so a foreign `Origin` is refused first.
 */
export function upgradeAccess(reader: SessionReader, isStudioAllowed: IsAllowed, frontendOrigins: string[]) {
  return async (req: IncomingMessage): Promise<Access> => {
    const origin = req.headers.origin;
    if (frontendOrigins.length && origin !== undefined && !frontendOrigins.includes(origin)) {
      return { type: 'denied', status: 403, error: 'Origin not allowed' };
    }
    // The session middlewares only read from the response here: the session is never modified, so nothing is written.
    const res = new ServerResponse(req);
    for (const middleware of reader.middlewares) {
      await new Promise<void>((resolve, reject) => middleware(req, res, (err?: unknown) => (err ? reject(err) : resolve())));
    }
    return access({ type: 'session', identity: reader.sessionIdentity(req) }, isStudioAllowed, async () => false);
  };
}
