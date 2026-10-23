import type { IncomingMessage } from 'node:http';
import type { Connect, Plugin } from 'vite';
import { isCharacterName } from '@officexr/world/characters';
import studioStorage, { studioMapExists } from '@officexr/world/vite-plugin-storage';
import { MAX_DESCRIPTION, MAX_NAME } from './officeLimits';
import { configJsMiddleware } from './runtimeConfig';
import { staticDirMiddleware } from './staticDir';

export interface Office {
  id: string;
  name: string;
  description: string | null;
  map_name: string | null;
  created_by_login: string | null;
  debug_enabled: boolean;
}

/** Lists all offices, or just the one with `id` when given. */
export type QueryOffices = (id?: string) => Promise<Office[]>;

export interface NewOffice {
  name: string;
  description: string | null;
  mapName: string;
  createdByLogin: string;
}

export type CreateOffice = (input: NewOffice) => Promise<Office>;

/** The settings a creator may change; only the keys present are written. */
export type OfficeUpdate = Partial<Pick<NewOffice, 'name' | 'description' | 'mapName'>> & { debugEnabled?: boolean };

export type UpdateOffice = (id: string, update: OfficeUpdate) => Promise<Office>;

/** Whether a studio map with this name exists; must reject names that aren't plain slugs. */
export type MapExists = (name: string) => Promise<boolean>;

/** Each user's character choice per office. */
export interface OfficeCharacters {
  get: (officeId: string, login: string) => Promise<string | null>;
  set: (officeId: string, login: string, characterId: string) => Promise<void>;
}

export interface Identity {
  login: string;
  name: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Decodes RFC 2047 UTF-8 encoded words (`=?utf-8?q?…?=` / `?b?`), which Tailscale uses for non-ASCII names. */
function decodeMimeWords(value: string): string {
  return value.replace(/(\?=)\s+(?==\?)/g, '$1').replace(/=\?utf-8\?([qb])\?(.*?)\?=/gi, (_, kind: string, text: string) =>
    kind.toLowerCase() === 'b'
      ? Buffer.from(text, 'base64').toString('utf8')
      : Buffer.from(
          text.replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16))),
          'latin1',
        ).toString('utf8'),
  );
}

/** Tailscale Serve sets these headers on proxied tailnet requests and strips client-supplied copies. */
export function tailscaleIdentity(req: IncomingMessage): Identity | null {
  const login = req.headers['tailscale-user-login'] as string | undefined;
  if (!login) {
    return null;
  }
  const name = req.headers['tailscale-user-name'] as string | undefined;
  return { login, name: name ? decodeMimeWords(name) : login };
}

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

export function apiMiddleware(
  queryOffices: QueryOffices,
  characters: OfficeCharacters,
  createOffice: CreateOffice,
  updateOffice: UpdateOffice,
  mapExists: MapExists,
): Connect.NextHandleFunction {
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
    try {
      if (path === '/api/me') {
        const me = tailscaleIdentity(req);
        return me ? send(200, me) : send(401, { error: 'Not identified via Tailscale' });
      }
      if (path === '/api/offices') {
        if (req.method === 'POST') {
          const me = tailscaleIdentity(req);
          if (!me) {
            return send(401, { error: 'Not identified via Tailscale' });
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
        const me = tailscaleIdentity(req);
        if (!me) {
          return send(401, { error: 'Not identified via Tailscale' });
        }
        const [office] = UUID.test(characterOffice) ? await queryOffices(characterOffice) : [];
        if (!office) {
          return send(404, { error: 'Office not found' });
        }
        if (req.method === 'GET') {
          return send(200, { characterId: await characters.get(office.id, me.login) });
        }
        if (req.method === 'PUT') {
          const body = await readJson(req);
          if (body === TOO_LARGE) {
            return send(413, { error: 'Body too large' });
          }
          const characterId = (body as { characterId?: unknown } | null)?.characterId;
          if (!isCharacterName(characterId)) {
            return send(400, { error: 'Unknown character' });
          }
          await characters.set(office.id, me.login, characterId);
          return send(200, { characterId });
        }
        return send(405, { error: 'Method not allowed' });
      }
      const id = path.match(/^\/api\/offices\/([^/]+)$/)?.[1];
      if (id) {
        if (req.method !== 'GET' && req.method !== 'PATCH') {
          return send(405, { error: 'Method not allowed' });
        }
        const me = tailscaleIdentity(req);
        if (req.method === 'PATCH' && !me) {
          return send(401, { error: 'Not identified via Tailscale' });
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
        return send(200, Object.keys(update).length ? await updateOffice(office.id, update) : office);
      }
      return send(404, { error: 'Not found' });
    } catch (err) {
      console.error(err);
      return send(500, { error: 'Internal error' });
    }
  };
}

/** Sets the Tailscale headers on every request so local dev works without a tailnet. */
function devUserMiddleware(user: Identity): Connect.NextHandleFunction {
  return (req, _res, next) => {
    req.headers['tailscale-user-login'] = user.login;
    req.headers['tailscale-user-name'] = user.name;
    next();
  };
}

export interface ServerPluginOptions {
  queryOffices: QueryOffices;
  characters: OfficeCharacters;
  createOffice: CreateOffice;
  updateOffice: UpdateOffice;
  /** Applied to the dev server only, never to preview. */
  devUser?: Identity;
  devEnv?: Record<string, string>;
  /** Studio data dir served read-only under `/api`; the storage plugin's defaults when unset. */
  studioDataDir?: string;
  /** Character and object models served at `/models`. */
  modelsDir: string;
}

export function officexrServer({
  queryOffices,
  characters,
  createOffice,
  updateOffice,
  devUser,
  devEnv,
  studioDataDir,
  modelsDir,
}: ServerPluginOptions): Plugin[] {
  const models = staticDirMiddleware('/models', modelsDir);
  const api = apiMiddleware(queryOffices, characters, createOffice, updateOffice, studioMapExists(studioDataDir));
  return [
    // Before `apiMiddleware`, which answers every other `/api/*` path with a 404.
    studioStorage({ dataDir: studioDataDir, readOnly: true }),
    {
      name: 'officexr-server',
      configureServer: (server) => {
        if (devUser) {
          server.middlewares.use(devUserMiddleware(devUser));
        }
        server.middlewares.use(models);
        server.middlewares.use(configJsMiddleware(devEnv));
        server.middlewares.use(api);
      },
      configurePreviewServer: (server) => {
        server.middlewares.use(models);
        server.middlewares.use(configJsMiddleware());
        server.middlewares.use(api);
      },
    },
  ];
}
