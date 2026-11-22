import type { NextHandleFunction } from 'connect';
import type { QueryOffices } from './api';
import { createTtlCache } from './ttlCache';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FOUND_TTL_MS = 60_000;
const MISSING_TTL_MS = 10_000;
const WINDOW_MS = 60_000;
export const LOOKUPS_PER_WINDOW = 60;

export interface OfficeLookupOptions {
  queryOffices: QueryOffices;
  now?: () => number;
}

/** Without a proxy the socket address is the client; behind one, the hop its own proxy appended is the last entry. */
const clientKey = (req: Parameters<NextHandleFunction>[0]) => {
  const forwarded = req.headers['x-forwarded-for'];
  const last = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded)?.split(',').at(-1)?.trim();
  return last || req.socket.remoteAddress || '';
};

export function officeLookupMiddleware({ queryOffices, now = Date.now }: OfficeLookupOptions): NextHandleFunction {
  const names = createTtlCache<string | null>({ ttlMs: (name) => (name === null ? MISSING_TTL_MS : FOUND_TTL_MS), now });
  const windows = new Map<string, { startedAt: number; count: number }>();
  const overLimit = (key: string) => {
    const at = now();
    for (const [k, w] of windows) {
      if (at - w.startedAt >= WINDOW_MS) {
        windows.delete(k);
      }
    }
    const current = windows.get(key) ?? { startedAt: at, count: 0 };
    current.count += 1;
    windows.set(key, current);
    return current.count > LOOKUPS_PER_WINDOW;
  };
  return async (req, res, next) => {
    const id = (req.url?.split('?')[0] ?? '').match(/^\/api\/offices\/([^/]+)\/name$/)?.[1];
    if (id === undefined) {
      return next();
    }
    const send = (status: number, body: unknown, cache?: string) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      if (cache) {
        res.setHeader('Cache-Control', cache);
      }
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'GET') {
      return send(405, { error: 'Method not allowed' });
    }
    if (overLimit(clientKey(req))) {
      res.setHeader('Retry-After', String(WINDOW_MS / 1000));
      return send(429, { error: 'Too many requests' });
    }
    if (!UUID.test(id)) {
      return send(404, { error: 'Office not found' });
    }
    try {
      const key = id.toLowerCase();
      const name = await names.getOrLoad(key, async () => (await queryOffices(key))[0]?.name ?? null);
      return name === null ? send(404, { error: 'Office not found' }) : send(200, { name }, `public, max-age=${FOUND_TTL_MS / 1000}`);
    } catch (err) {
      console.error(err);
      return send(500, { error: 'Internal error' });
    }
  };
}
