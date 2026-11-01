import { createServer, ServerResponse, type IncomingMessage, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import connect from 'connect';
import httpProxy from 'http-proxy';
import { close } from '@officexr/server/listen';
import { staticDirMiddleware } from '@officexr/server/static';
import { loopbackOrigin, mountMcp, type McpOptions } from '@officexr/studio-mcp/mount-mcp';
import type { StudioStorage } from '@officexr/world/vite-plugin-storage';

export interface StudioListener {
  server: Server;
  /** Stops listening, drops proxied WebSockets and resolves once every connection has ended. */
  close(): Promise<void>;
}

const pathname = (req: IncomingMessage) => req.url?.split('?')[0];

/** Serves `/health` and `/ws` upgrades on `app`/`server` from the realtime server at `target`. */
function proxyRealtime(app: connect.Server, server: Server, target: string): () => void {
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
    proxy.ws(req, socket, head);
  });
  return () => {
    for (const socket of tunnels) {
      socket.destroy();
    }
  };
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

/** Studio storage, `/models`, `/mcp`, the realtime proxy and the built studio SPA. */
export function createInternalServer(opts: {
  storage: StudioStorage;
  modelsDir: string;
  studioDist: string;
  mcp: Omit<McpOptions, 'origin'>;
  realtimeTarget: string;
}): StudioListener {
  const app = connect();
  const server = createServer(app);
  opts.storage.mount(app);
  app.use(staticDirMiddleware('/models', opts.modelsDir));
  mountMcp(app, { ...opts.mcp, origin: () => loopbackOrigin(server) });
  const dropTunnels = proxyRealtime(app, server, opts.realtimeTarget);
  app.use((req, res, next) => {
    const isIndex = pathname(req) === '/' || pathname(req) === '/index.html';
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
  app.use(staticDirMiddleware('', opts.studioDist));
  return listener(server, dropTunnels);
}

/** Studio storage, `/models` and the realtime proxy. */
export function createPublicServer(opts: {
  storage: StudioStorage;
  modelsDir: string;
  realtimeTarget: string;
}): StudioListener {
  const app = connect();
  const server = createServer(app);
  opts.storage.mount(app);
  app.use(staticDirMiddleware('/models', opts.modelsDir));
  return listener(server, proxyRealtime(app, server, opts.realtimeTarget));
}
