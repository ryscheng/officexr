import { createServer, ServerResponse, STATUS_CODES, type IncomingMessage, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import connect from 'connect';
import httpProxy from 'http-proxy';
import { createCors, type createSessionReader } from '@officexr/server';
import { close } from '@officexr/server/listen';
import { staticDirMiddleware } from '@officexr/server/static';
import { loopbackOrigin, mcpHandler, type McpOptions } from '@officexr/studio-mcp/mount-mcp';
import type { StudioStorage } from '@officexr/world/vite-plugin-storage';
import type { ModelSources } from '@officexr/studio-mcp/model-sources';
import { pathname } from './http.ts';
import { modelSourceRoutes } from './model-sources/routes.ts';
import { agentTokenRoutes } from './agent-tokens/routes.ts';
import type { AgentTokens } from '@officexr/studio-mcp/agent-tokens';
import { sendJson, studioGate, upgradeAccess, type Access, type IsAllowed } from './studio-gate.ts';

export interface StudioListener {
  server: Server;
  /** Stops listening, drops proxied WebSockets and resolves once every connection has ended. */
  close(): Promise<void>;
}

/**
 * Serves `/health` and `/ws` upgrades on `app`/`server` from the realtime server at `target`; with `authorizeUpgrade`,
 * only upgrades it allows are proxied.
 */
function proxyRealtime(
  app: connect.Server,
  server: Server,
  target: string,
  authorizeUpgrade?: (req: IncomingMessage) => Promise<Access>,
): () => void {
  const proxy = httpProxy.createProxyServer({ target, changeOrigin: true });
  proxy.on('error', (err, _req, res) => {
    console.warn('[studio-server] realtime proxy:', err.message);
    if (res instanceof ServerResponse) {
      if (!res.headersSent) {
        res.writeHead(502);
      }
      res.end();
    } else {
      res.destroy();
    }
  });
  app.use((req, res, next) => {
    if (pathname(req) === '/health') {
      proxy.web(req, res);
    } else {
      next();
    }
  });
  // Upgraded sockets outlive `server.close()`, so they are tracked to be dropped on close.
  const tunnels = new Set<Duplex>();
  server.on('upgrade', (req, socket: Duplex, head) => {
    // Node drops its own socket error handler once an upgrade listener owns the socket, and
    // http-proxy adds one only after the target answers, so a client reset before that would crash.
    socket.on('error', (err) => {
      console.warn('[studio-server] upgrade socket:', err.message);
      socket.destroy();
    });
    if (pathname(req) !== '/ws') {
      socket.destroy();
      return;
    }
    tunnels.add(socket);
    socket.once('close', () => tunnels.delete(socket));
    if (!authorizeUpgrade) {
      proxy.ws(req, socket, head);
      return;
    }
    authorizeUpgrade(req).then(
      (access) => {
        if (socket.destroyed) {
          return;
        }
        if (access.type === 'allowed') {
          proxy.ws(req, socket, head);
        } else {
          refuseUpgrade(socket, access.status);
        }
      },
      (err: Error) => {
        console.error('[studio-server] upgrade auth:', err);
        refuseUpgrade(socket, 500);
      },
    );
  });
  return () => {
    for (const socket of tunnels) {
      socket.destroy();
    }
  };
}

function refuseUpgrade(socket: Duplex, status: number) {
  if (!socket.destroyed) {
    socket.end(`HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  }
}

function listener(server: Server, dropTunnels: () => void): StudioListener {
  return {
    server,
    close: () => {
      const closed = close(server);
      dropTunnels();
      return closed;
    },
  };
}

function mountModels(app: connect.Server, opts: { modelsDir: string; uploadedModelsDir?: string }) {
  if (opts.uploadedModelsDir) {
    app.use(staticDirMiddleware('/models', opts.uploadedModelsDir));
  }
  app.use(staticDirMiddleware('/models', opts.modelsDir));
}

/** Studio storage, `/models`, `/mcp`, the realtime proxy and the built studio SPA. */
export function createInternalServer(opts: {
  storage: StudioStorage;
  modelsDir: string;
  /** Served at `/models` before `modelsDir`. */
  uploadedModelsDir?: string;
  studioDist: string;
  mcp: Omit<McpOptions, 'origin'>;
  realtimeTarget: string;
}): StudioListener & {
  /** The `/mcp` endpoint on this listener, so another listener can serve the same options with loopback to this one. */
  mcp: connect.NextHandleFunction;
} {
  const app = connect();
  const server = createServer(app);
  opts.storage.mount(app);
  mountModels(app, opts);
  const mcp = mcpHandler({ ...opts.mcp, origin: () => loopbackOrigin(server) });
  app.use('/mcp', mcp);
  const dropTunnels = proxyRealtime(app, server, opts.realtimeTarget);
  app.use((req, res, next) => {
    const p = pathname(req);
    if ((p === '/' || p === '/studio') && (req.method === 'GET' || req.method === 'HEAD')) {
      res.writeHead(302, { Location: '/studio/' }).end();
      return;
    }
    next();
  });
  app.use((req, res, next) => {
    const isIndex = pathname(req) === '/studio/' || pathname(req) === '/studio/index.html';
    if (!isIndex || (req.method !== 'GET' && req.method !== 'HEAD')) {
      next();
      return;
    }
    readFile(path.join(opts.studioDist, 'index.html')).then((html) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      // Revalidated so a deploy never leaves browsers on a shell whose hashed assets are gone.
      res.setHeader('Cache-Control', 'no-cache');
      res.end(req.method === 'HEAD' ? undefined : html);
    }, next);
  });
  app.use(staticDirMiddleware('/studio', opts.studioDist));
  return { ...listener(server, dropTunnels), mcp };
}

/** Studio storage, `/models` and the realtime proxy, each only for a signed-in user on `studio_allowlist`, plus `GET /api/me`. */
export function createPublicServer(opts: {
  storage: StudioStorage;
  modelsDir: string;
  /** Served at `/models` before `modelsDir`. */
  uploadedModelsDir?: string;
  realtimeTarget: string;
  frontendOrigins: string[];
  sessionReader: ReturnType<typeof createSessionReader>;
  isStudioAllowed: IsAllowed;
  /** `null` when no model-source bucket is configured: its routes answer 503. */
  modelSources: ModelSources | null;
  /** `null` when agent tokens are not configured: `/api/agent-token-requests` answers 503. */
  agentTokens: AgentTokens | null;
  /** Mounted ahead of the gate, e.g. `createOAuthApp(...).handler`. */
  oauth?: connect.NextHandleFunction;
}): StudioListener {
  const app = connect();
  const server = createServer(app);
  if (opts.frontendOrigins.length) {
    app.use(createCors(opts.frontendOrigins));
  }
  opts.sessionReader.middlewares.forEach((middleware) => app.use(middleware));
  if (opts.oauth) {
    app.use(opts.oauth);
  }
  app.use(studioGate(opts.sessionReader, opts.isStudioAllowed));
  app.use('/api/model-sources', modelSourceRoutes(opts.modelSources));
  app.use('/api/agent-token-requests', agentTokenRoutes(opts.agentTokens, opts.sessionReader));
  opts.storage.mount(app);
  mountModels(app, opts);
  const authorizeUpgrade = upgradeAccess(opts.sessionReader, opts.isStudioAllowed, opts.frontendOrigins);
  const dropTunnels = proxyRealtime(app, server, opts.realtimeTarget, authorizeUpgrade);
  // Replaces connect's default handler, which sends the stack trace unless NODE_ENV is production.
  app.use((err: Error, _req: IncomingMessage, res: ServerResponse, _next: connect.NextFunction) => {
    console.error('[studio-server] public request:', err);
    if (res.headersSent) {
      res.destroy();
    } else {
      sendJson(res, 500, { error: 'Internal error' });
    }
  });
  return listener(server, dropTunnels);
}
