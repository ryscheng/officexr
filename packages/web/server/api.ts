import type { IncomingMessage } from 'node:http';
import type { Connect, Plugin } from 'vite';
import studioStorage from '@officexr/world/vite-plugin-storage';
import { configJsMiddleware } from './runtimeConfig';
import { staticDirMiddleware } from './staticDir';

export interface Office {
  id: string;
  name: string;
  description: string | null;
  map_name: string | null;
}

/** Lists all offices, or just the one with `id` when given. */
export type QueryOffices = (id?: string) => Promise<Office[]>;

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

export function apiMiddleware(queryOffices: QueryOffices): Connect.NextHandleFunction {
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
        return send(200, await queryOffices());
      }
      const id = path.match(/^\/api\/offices\/([^/]+)$/)?.[1];
      if (id) {
        const [office] = UUID.test(id) ? await queryOffices(id) : [];
        return office ? send(200, office) : send(404, { error: 'Office not found' });
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
  /** Applied to the dev server only, never to preview. */
  devUser?: Identity;
  devEnv?: Record<string, string>;
  /** Studio data dir served read-only under `/api`; the storage plugin's defaults when unset. */
  studioDataDir?: string;
  /** Character and object models served at `/models`. */
  modelsDir: string;
}

export function officexrServer({ queryOffices, devUser, devEnv, studioDataDir, modelsDir }: ServerPluginOptions): Plugin[] {
  const models = staticDirMiddleware('/models', modelsDir);
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
        server.middlewares.use(apiMiddleware(queryOffices));
      },
      configurePreviewServer: (server) => {
        server.middlewares.use(models);
        server.middlewares.use(configJsMiddleware());
        server.middlewares.use(apiMiddleware(queryOffices));
      },
    },
  ];
}
