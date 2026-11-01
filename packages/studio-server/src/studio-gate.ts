import { ServerResponse, type IncomingMessage } from 'node:http';
import type { NextHandleFunction } from 'connect';
import type pg from 'pg';
import { emailDomain, type createSessionReader } from '@officexr/server';
import type { Identity } from '@officexr/server/shared';

export type IsStudioAllowed = (login: string) => Promise<boolean>;
type SessionReader = ReturnType<typeof createSessionReader>;

export type Access = { type: 'allowed'; identity: Identity } | { type: 'denied'; status: 401 | 403; error: string };

export function pgIsStudioAllowed(pool: pg.Pool): IsStudioAllowed {
  return async (login) => {
    const { rows } = await pool.query<{ allowed: boolean }>(
      `select exists (select 1 from studio_allowlist where (kind = 'email' and value = $1) or (kind = 'domain' and value = $2)) as allowed`,
      [login, emailDomain(login)],
    );
    return rows[0].allowed;
  };
}

/** Remembers each login's answer for `ttlMs`; a failed lookup is not remembered. */
export function cacheIsStudioAllowed(isStudioAllowed: IsStudioAllowed, ttlMs = 60_000, now = Date.now): IsStudioAllowed {
  // ponytail: a login removed from studio_allowlist keeps access for up to ttlMs.
  const answers = new Map<string, { allowed: boolean; expires: number }>();
  return async (login) => {
    const cached = answers.get(login);
    if (cached && cached.expires > now()) {
      return cached.allowed;
    }
    const allowed = await isStudioAllowed(login);
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

function sendJson(res: ServerResponse, status: number, body: unknown) {
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
      } else if (req.method === 'GET' && req.url?.split('?')[0] === '/api/me') {
        sendJson(res, 200, { login: result.identity.login, name: result.identity.name });
      } else {
        next();
      }
    }, next);
  };
}

/** The same check for a WebSocket upgrade, which never reaches the app's middleware stack. */
export function upgradeAccess(reader: SessionReader, isStudioAllowed: IsStudioAllowed) {
  return async (req: IncomingMessage): Promise<Access> => {
    // The session middlewares only read from the response here: the session is never modified, so nothing is written.
    const res = new ServerResponse(req);
    for (const middleware of reader.middlewares) {
      await new Promise<void>((resolve, reject) => middleware(req, res, (err?: unknown) => (err ? reject(err) : resolve())));
    }
    return access(reader.sessionIdentity(req), isStudioAllowed);
  };
}
