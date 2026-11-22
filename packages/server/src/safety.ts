import type { IncomingMessage } from 'node:http';
import type { NextHandleFunction } from 'connect';
import { ZReportRequest, type SocialCapabilities } from '@officexr/sdk';
import type { ResolveIdentity } from './api';
import { createCooldown } from './cooldown';
import type { BlocksStore, ReportsStore } from './safetyStore';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 4096;
const MAX_NAME = 100;
const REPORT_PAIR_COOLDOWN_MS = 60_000;
const REPORT_ANY_COOLDOWN_MS = 5_000;
const TOO_LARGE = Symbol('too large');

export const SOCIAL_CAPABILITIES: SocialCapabilities = { block: true, report: true, nearbyChat: true, directChat: true };

export interface SafetyOptions {
  identity: ResolveIdentity;
  blocks: BlocksStore;
  reports: ReportsStore;
  realtime: { refreshBlocks: (login: string) => Promise<void> };
  now?: () => number;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) {
      return TOO_LARGE;
    }
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

const decode = (part: string) => {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
};

export function safetyMiddleware({ identity, blocks, reports, realtime, now = Date.now }: SafetyOptions): NextHandleFunction {
  const pairCooldown = createCooldown(REPORT_PAIR_COOLDOWN_MS, now);
  const anyCooldown = createCooldown(REPORT_ANY_COOLDOWN_MS, now);
  return async (req, res, next) => {
    const path = req.url?.split('?')[0] ?? '';
    const blockRoute = path.match(/^\/api\/blocks(?:\/([^/]+))?$/);
    if (path !== '/api/social' && path !== '/api/reports' && !blockRoute) {
      return next();
    }
    const send = (status: number, body?: unknown) => {
      res.statusCode = status;
      if (body === undefined) {
        return res.end();
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    };
    try {
      if (path === '/api/social') {
        return req.method === 'GET' ? send(200, SOCIAL_CAPABILITIES) : send(405, { error: 'Method not allowed' });
      }
      const me = await identity(req);
      if (!me) {
        return send(401, { error: 'Not signed in' });
      }
      if (path === '/api/reports') {
        if (req.method !== 'POST') {
          return send(405, { error: 'Method not allowed' });
        }
        const body = await readJson(req);
        if (body === TOO_LARGE) {
          return send(413, { error: 'Body too large' });
        }
        const parsed = ZReportRequest.safeParse(body);
        if (!parsed.success || parsed.data.login === me.login || parsed.data.login.includes('#')) {
          return send(400, { error: 'invalid' });
        }
        const { login, reason, officeId } = parsed.data;
        const pair = `${me.login}|${login}`;
        if (pairCooldown.take(pair) > 0) {
          return send(429, { error: 'Too many reports' });
        }
        if (anyCooldown.take(me.login) > 0) {
          pairCooldown.release(pair);
          return send(429, { error: 'Too many reports' });
        }
        const note = parsed.data.note?.trim() || null;
        try {
          await reports.add({ officeId: officeId && UUID.test(officeId) ? officeId.toLowerCase() : null, reporter: me.login, reported: login, reason, note });
        } catch (err) {
          anyCooldown.release(me.login);
          pairCooldown.release(pair);
          throw err;
        }
        return send(201, {});
      }
      const target = blockRoute?.[1] === undefined ? undefined : decode(blockRoute[1]);
      if (target === undefined) {
        if (req.method !== 'GET') {
          return send(405, { error: 'Method not allowed' });
        }
        return send(200, { blocks: await blocks.list(me.login) });
      }
      if (target === null || target === '' || target.includes('#') || target.length > 200) {
        return send(400, { error: 'invalid' });
      }
      if (req.method === 'PUT') {
        if (target === me.login) {
          return send(400, { error: 'Cannot block yourself' });
        }
        const body = await readJson(req);
        if (body === TOO_LARGE) {
          return send(413, { error: 'Body too large' });
        }
        const rawName = (body as { name?: unknown } | null)?.name;
        const name = typeof rawName === 'string' && rawName.trim() ? Array.from(rawName.trim()).slice(0, MAX_NAME).join('') : null;
        if ((await blocks.add(me.login, target, name)) === 'limit') {
          return send(409, { error: 'limit' });
        }
      } else if (req.method === 'DELETE') {
        await blocks.remove(me.login, target);
      } else {
        return send(405, { error: 'Method not allowed' });
      }
      await realtime.refreshBlocks(me.login);
      return send(200, { blocks: await blocks.list(me.login) });
    } catch (err) {
      console.error(err);
      return send(500, { error: 'Internal error' });
    }
  };
}
