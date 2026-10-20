import type { IncomingMessage } from 'node:http';
import type { Connect, Plugin } from 'vite';
import { configJsMiddleware } from './runtimeConfig';

export interface Office {
  id: string;
  name: string;
  description: string | null;
}

/** Lists all offices, or just the one with `id` when given. */
export type QueryOffices = (id?: string) => Promise<Office[]>;

export interface DevUser {
  login: string;
  name: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/** Tailscale Serve sets these headers on proxied tailnet requests and strips client-supplied copies. */
export function tailscaleIdentity(req: IncomingMessage): DevUser | null {
  const login = header(req, 'tailscale-user-login');
  if (!login) {
    return null;
  }
  return { login, name: header(req, 'tailscale-user-name') ?? login };
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
function devUserMiddleware(user: DevUser): Connect.NextHandleFunction {
  return (req, _res, next) => {
    req.headers['tailscale-user-login'] = user.login;
    req.headers['tailscale-user-name'] = user.name;
    next();
  };
}

export interface ServerPluginOptions {
  queryOffices: QueryOffices;
  /** Applied to the dev server only, never to preview. */
  devUser?: DevUser;
  devEnv?: Record<string, string>;
}

export function officexrServer({ queryOffices, devUser, devEnv }: ServerPluginOptions): Plugin {
  return {
    name: 'officexr-server',
    configureServer: (server) => {
      if (devUser) {
        server.middlewares.use(devUserMiddleware(devUser));
      }
      server.middlewares.use(configJsMiddleware(devEnv));
      server.middlewares.use(apiMiddleware(queryOffices));
    },
    configurePreviewServer: (server) => {
      server.middlewares.use(configJsMiddleware());
      server.middlewares.use(apiMiddleware(queryOffices));
    },
  };
}
