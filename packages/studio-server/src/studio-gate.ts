import { ServerResponse, type IncomingMessage } from 'node:http';
import type { NextHandleFunction } from 'connect';
import type { createSessionReader } from '@officexr/server';
import type { Identity } from '@officexr/server/shared';
import { pathname } from './http.ts';

export type IsStudioAllowed = (login: string) => Promise<boolean>;
type SessionReader = ReturnType<typeof createSessionReader>;

export type Access = { type: 'allowed'; identity: Identity } | { type: 'denied'; status: 401 | 403; error: string };

/** Remembers each login's answer for `ttlMs`; a failed lookup is not remembered. */
export function cacheAllowlist(isAllowed: IsStudioAllowed, ttlMs = 60_000, now = Date.now): IsStudioAllowed {
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

async function access(identity: Identity | null, isStudioAllowed: IsStudioAllowed): Promise<Access> {
  if (!identity) {
    return { type: 'denied', status: 401, error: 'Not signed in' };
  }
  return (await isStudioAllowed(identity.login)) ? { type: 'allowed', identity } : { type: 'denied', status: 403, error: 'Not allowed' };
}

export function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

/**
 * Mount after the session reader's middlewares. Answers `GET /api/me` itself, refuses every request without an
 * allowed identity, and passes allowed ones on; a failed allowlist lookup goes to the error handler.
 */
export function studioGate(reader: SessionReader, isStudioAllowed: IsStudioAllowed): NextHandleFunction {
  return (req, res, next) => {
    access(reader.sessionIdentity(req), isStudioAllowed).then((result) => {
      if (result.type === 'denied') {
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
export function upgradeAccess(reader: SessionReader, isStudioAllowed: IsStudioAllowed, frontendOrigins: string[]) {
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
    return access(reader.sessionIdentity(req), isStudioAllowed);
  };
}
