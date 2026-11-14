import type { IncomingMessage } from 'node:http';
import type { NextHandleFunction } from 'connect';
import { signJoinToken } from '@officexr/realtime-server/join-token';
import { isKnownCharacter, type CatalogCharacters } from '@officexr/world/characters';
import { DEFAULT_MAP, type SerializedMap } from '@officexr/world/scenes';
import { MAX_DESCRIPTION, MAX_NAME } from './officeLimits';
import type { Identity, NewOffice, Office, OfficeUpdate } from './shared';

/** Lists all offices, or just the one with `id` when given. */
export type QueryOffices = (id?: string) => Promise<Office[]>;

export type CreateOffice = (input: NewOffice) => Promise<Office>;

/** Resolves to `undefined` when the office no longer exists. */
export type UpdateOffice = (id: string, update: OfficeUpdate) => Promise<Office | undefined>;

/** Whether a studio map with this name exists; must reject names that aren't plain slugs. */
export type MapExists = (name: string) => Promise<boolean>;

/** Each user's character choice per office. */
export interface OfficeCharacters {
  get: (officeId: string, login: string) => Promise<string | null>;
  set: (officeId: string, login: string, characterId: string) => Promise<void>;
}

/** Loads a studio map by name; null when it doesn't exist or isn't a valid map. */
export type LoadMap = (name: string) => Promise<Pick<SerializedMap, 'deskAreas'> | null>;

/** Desk claims per office; the database allows one desk per login and one login per desk. */
export interface OfficeDeskClaims {
  /** Login by desk id. */
  list: (officeId: string) => Promise<Record<string, string>>;
  /** Moves the login's existing claim to `deskId`; 'taken' when another login holds it. */
  claim: (officeId: string, login: string, deskId: string) => Promise<'ok' | 'taken'>;
  release: (officeId: string, login: string) => Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ResolveIdentity = (req: IncomingMessage) => Identity | null | Promise<Identity | null>;

const JOIN_TOKEN_TTL_MS = 120_000;
const MAX_BODY_BYTES = 4096;
const TOO_LARGE = Symbol('too large');

/** The parsed JSON body, `null` when it isn't JSON, or `TOO_LARGE` past `MAX_BODY_BYTES`. */
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

const NAME_ERROR = `name is required (max ${MAX_NAME} characters)`;

/** The validated fields that are present, or the error to send back with a 400. */
async function parseOfficeUpdate(body: unknown, mapExists: MapExists): Promise<OfficeUpdate | string> {
  if (typeof body !== 'object' || body === null) {
    return 'body must be a JSON object';
  }
  const raw = body as Record<string, unknown>;
  const update: OfficeUpdate = {};
  if (raw.name !== undefined) {
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!name || name.length > MAX_NAME) {
      return NAME_ERROR;
    }
    update.name = name;
  }
  if (raw.description !== undefined) {
    if (typeof raw.description !== 'string') {
      return 'description must be text';
    }
    const description = raw.description.trim();
    if (description.length > MAX_DESCRIPTION) {
      return `description is too long (max ${MAX_DESCRIPTION} characters)`;
    }
    update.description = description || null;
  }
  if (raw.mapName !== undefined) {
    if (typeof raw.mapName !== 'string' || !(await mapExists(raw.mapName))) {
      return 'Unknown map';
    }
    update.mapName = raw.mapName;
  }
  if (raw.debugEnabled !== undefined) {
    if (typeof raw.debugEnabled !== 'boolean') {
      return 'debugEnabled must be true or false';
    }
    update.debugEnabled = raw.debugEnabled;
  }
  return update;
}

/** The validated input, or the error to send back with a 400. */
async function parseNewOffice(body: unknown, mapExists: MapExists): Promise<Omit<NewOffice, 'createdByLogin'> | string> {
  // Before parsing, so a missing name never costs a map lookup.
  if ((body as { name?: unknown } | null)?.name === undefined) {
    return NAME_ERROR;
  }
  const update = await parseOfficeUpdate(body, mapExists);
  if (typeof update === 'string') {
    return update;
  }
  if (update.name === undefined) {
    return NAME_ERROR;
  }
  if (update.mapName === undefined) {
    return 'Unknown map';
  }
  return { name: update.name, description: update.description ?? null, mapName: update.mapName };
}

export interface ApiOptions {
  queryOffices: QueryOffices;
  characters: OfficeCharacters;
  deskClaims: OfficeDeskClaims;
  createOffice: CreateOffice;
  updateOffice: UpdateOffice;
  mapExists: MapExists;
  loadMap: LoadMap;
  /** The catalog's characters, which players may pick besides the built-ins. */
  loadCatalogCharacters: () => Promise<CatalogCharacters>;
  identity: ResolveIdentity;
  realtimeTokenSecret?: string;
}

export function apiMiddleware({
  queryOffices,
  characters,
  deskClaims,
  createOffice,
  updateOffice,
  mapExists,
  loadMap,
  loadCatalogCharacters,
  identity,
  realtimeTokenSecret,
}: ApiOptions): NextHandleFunction {
  return async (req, res, next) => {
    const path = req.url?.split('?')[0] ?? '';
    if (!path.startsWith('/api/')) {
      return next();
    }
    const send = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    };
    /** Runs `handle` for the signed-in user and the office `officeId`, or answers 401 / 404. */
    const withOffice = async (officeId: string, handle: (me: Identity, office: Office) => Promise<void>) => {
      const me = await identity(req);
      if (!me) {
        return send(401, { error: 'Not signed in' });
      }
      const [office] = UUID.test(officeId) ? await queryOffices(officeId) : [];
      return office ? handle(me, office) : send(404, { error: 'Office not found' });
    };
    try {
      if (path === '/api/me') {
        const me = await identity(req);
        return me ? send(200, me) : send(401, { error: 'Not signed in' });
      }
      if (path === '/api/realtime-token') {
        // An empty secret counts as unset: signing with it throws.
        if (!realtimeTokenSecret) {
          return send(404, { error: 'Realtime tokens are not enabled' });
        }
        const me = await identity(req);
        if (!me) {
          return send(401, { error: 'Not signed in' });
        }
        return send(200, { token: signJoinToken(realtimeTokenSecret, { login: me.login, ttlMs: JOIN_TOKEN_TTL_MS }) });
      }
      if (path === '/api/offices') {
        if (req.method === 'POST') {
          const me = await identity(req);
          if (!me) {
            return send(401, { error: 'Not signed in' });
          }
          const body = await readJson(req);
          if (body === TOO_LARGE) {
            return send(413, { error: 'Body too large' });
          }
          const input = await parseNewOffice(body, mapExists);
          return typeof input === 'string' ? send(400, { error: input }) : send(201, await createOffice({ ...input, createdByLogin: me.login }));
        }
        return req.method === 'GET' ? send(200, await queryOffices()) : send(405, { error: 'Method not allowed' });
      }
      const characterOffice = path.match(/^\/api\/offices\/([^/]+)\/character$/)?.[1];
      if (characterOffice) {
        return withOffice(characterOffice, async (me, office) => {
          if (req.method === 'GET') {
            return send(200, { characterId: await characters.get(office.id, me.login) });
          }
          if (req.method === 'PUT') {
            const body = await readJson(req);
            if (body === TOO_LARGE) {
              return send(413, { error: 'Body too large' });
            }
            const characterId = (body as { characterId?: unknown } | null)?.characterId;
            if (!isKnownCharacter(characterId, await loadCatalogCharacters())) {
              return send(400, { error: 'Unknown character' });
            }
            await characters.set(office.id, me.login, characterId);
            return send(200, { characterId });
          }
          return send(405, { error: 'Method not allowed' });
        });
      }
      const deskClaimsRoute = path.match(/^\/api\/offices\/([^/]+)\/desk-claims(\/me)?$/);
      if (deskClaimsRoute) {
        const isMe = deskClaimsRoute[2] !== undefined;
        return withOffice(deskClaimsRoute[1], async (me, office) => {
          if (req.method === 'GET' && !isMe) {
            return send(200, { claims: await deskClaims.list(office.id) });
          }
          if (req.method === 'PUT' && isMe) {
            const body = await readJson(req);
            if (body === TOO_LARGE) {
              return send(413, { error: 'Body too large' });
            }
            const deskId = (body as { deskId?: unknown } | null)?.deskId;
            const map = await loadMap(office.map_name ?? DEFAULT_MAP);
            if (typeof deskId !== 'string' || !map?.deskAreas?.some((area) => area.id === deskId)) {
              return send(400, { error: 'Unknown desk' });
            }
            if ((await deskClaims.claim(office.id, me.login, deskId)) === 'taken') {
              return send(409, { error: 'Desk taken' });
            }
            return send(200, { claims: await deskClaims.list(office.id) });
          }
          if (req.method === 'DELETE' && isMe) {
            await deskClaims.release(office.id, me.login);
            return send(200, { claims: await deskClaims.list(office.id) });
          }
          return send(405, { error: 'Method not allowed' });
        });
      }
      const id = path.match(/^\/api\/offices\/([^/]+)$/)?.[1];
      if (id) {
        if (req.method !== 'GET' && req.method !== 'PATCH') {
          return send(405, { error: 'Method not allowed' });
        }
        const me = await identity(req);
        if (req.method === 'PATCH' && !me) {
          return send(401, { error: 'Not signed in' });
        }
        const [office] = UUID.test(id) ? await queryOffices(id) : [];
        if (!office) {
          return send(404, { error: 'Office not found' });
        }
        if (req.method === 'GET') {
          return send(200, office);
        }
        if (office.created_by_login !== me?.login) {
          return send(403, { error: 'Only the office creator can change its settings' });
        }
        const body = await readJson(req);
        if (body === TOO_LARGE) {
          return send(413, { error: 'Body too large' });
        }
        const update = await parseOfficeUpdate(body, mapExists);
        if (typeof update === 'string') {
          return send(400, { error: update });
        }
        const updated = Object.keys(update).length ? await updateOffice(office.id, update) : office;
        return updated ? send(200, updated) : send(404, { error: 'Office not found' });
      }
      return send(404, { error: 'Not found' });
    } catch (err) {
      console.error(err);
      return send(500, { error: 'Internal error' });
    }
  };
}
