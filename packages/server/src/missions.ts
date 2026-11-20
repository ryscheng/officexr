import type { IncomingMessage } from 'node:http';
import type { NextHandleFunction } from 'connect';
import { MISSIONS_CHANGED_KIND, ZMissionPatch, ZNewMission, type MissionsChanged } from '@officexr/sdk';
import type { QueryOffices, ResolveIdentity } from './api';
import { mayPatch, type MissionsStore } from './missionsStore';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 32 * 1024;
const TOO_LARGE = Symbol('too large');
const NOT_JSON = Symbol('not json');

export interface MissionsPresence {
  notifyLogin: (officeId: string, login: string, kind: string, payload: unknown) => boolean;
  notifyOffice: (officeId: string, kind: string, payload: unknown) => boolean;
}

export interface MissionsOptions {
  identity: ResolveIdentity;
  queryOffices: QueryOffices;
  missions: MissionsStore;
  presence: MissionsPresence;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  if (!/^application\/json\s*(;|$)/i.test(req.headers['content-type'] ?? '')) {
    return NOT_JSON;
  }
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

export function missionsMiddleware({ identity, queryOffices, missions, presence }: MissionsOptions): NextHandleFunction {
  return async (req, res, next) => {
    const route = (req.url?.split('?')[0] ?? '').match(/^\/api\/offices\/([^/]+)\/missions(?:\/([^/]+))?$/);
    if (!route) {
      return next();
    }
    const [, officeId, missionId] = route;
    const send = (status: number, body?: unknown) => {
      res.statusCode = status;
      if (body === undefined) {
        return res.end();
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    };
    const changed = (office: { id: string }, owner: string, shared: boolean) => {
      const officeId = office.id;
      const payload: MissionsChanged = { officeId };
      if (shared) {
        presence.notifyOffice(officeId, MISSIONS_CHANGED_KIND, payload);
      } else {
        presence.notifyLogin(officeId, owner, MISSIONS_CHANGED_KIND, payload);
      }
    };
    try {
      const me = await identity(req);
      if (!me) {
        return send(401, { error: 'Not signed in' });
      }
      const [office] = UUID.test(officeId) ? await queryOffices(officeId) : [];
      if (!office) {
        return send(404, { error: 'Office not found' });
      }
      if (missionId === undefined) {
        if (req.method === 'GET') {
          return send(200, { missions: await missions.list(office.id, me.login) });
        }
        if (req.method !== 'POST') {
          return send(405, { error: 'Method not allowed' });
        }
        const body = await readJson(req);
        if (body === NOT_JSON) {
          return send(415, { error: 'Content-Type must be application/json' });
        }
        if (body === TOO_LARGE) {
          return send(413, { error: 'Body too large' });
        }
        const parsed = ZNewMission.safeParse(body);
        if (!parsed.success) {
          return send(400, { error: 'invalid' });
        }
        const created = await missions.create(office.id, me.login, parsed.data);
        if (created === 'limit') {
          return send(409, { error: 'limit' });
        }
        changed(office, me.login, created.shared);
        return send(201, { mission: created });
      }
      if (req.method !== 'PATCH' && req.method !== 'DELETE') {
        return send(405, { error: 'Method not allowed' });
      }
      const current = UUID.test(missionId) ? await missions.get(office.id, missionId) : undefined;
      if (!current || (current.ownerLogin !== me.login && !current.shared)) {
        return send(404, { error: 'Mission not found' });
      }
      const isOwner = current.ownerLogin === me.login;
      if (req.method === 'DELETE') {
        if (!isOwner) {
          return send(403, { error: 'Only the owner can delete a mission' });
        }
        await missions.remove(office.id, current.id);
        changed(office, current.ownerLogin, current.shared);
        return send(204);
      }
      const body = await readJson(req);
      if (body === NOT_JSON) {
        return send(415, { error: 'Content-Type must be application/json' });
      }
      if (body === TOO_LARGE) {
        return send(413, { error: 'Body too large' });
      }
      const parsed = ZMissionPatch.safeParse(body);
      if (!parsed.success) {
        return send(400, { error: 'invalid' });
      }
      const patch = parsed.data;
      if (!mayPatch(current, me.login, patch)) {
        return send(403, { error: 'Only the owner can edit a mission' });
      }
      const updated = await missions.update(office.id, current.id, me.login, patch);
      if (updated === undefined) {
        return send(404, { error: 'Mission not found' });
      }
      if (updated === 'limit') {
        return send(409, { error: 'limit' });
      }
      changed(office, updated.ownerLogin, updated.shared || current.shared);
      return send(200, { mission: updated });
    } catch (err) {
      console.error(err);
      return send(500, { error: 'Internal error' });
    }
  };
}
