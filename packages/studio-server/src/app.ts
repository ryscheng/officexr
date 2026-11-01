import { createServer, ServerResponse, type IncomingMessage, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import connect from 'connect';
import httpProxy from 'http-proxy';
import { staticDirMiddleware } from '@officexr/server';
import { mountMcp, type McpOptions } from '@officexr/studio-mcp/mount-mcp';
import type { StudioStorage } from '@officexr/world/vite-plugin-storage';

const pathname = (req: IncomingMessage) => req.url?.split('?')[0];

/** Studio storage, `/models`, `/mcp` and the built studio SPA. */
export function createInternalServer(opts: {
  storage: StudioStorage;
  modelsDir: string;
  studioDist: string;
  mcp: Omit<McpOptions, 'origin'>;
}): Server {
  const app = connect();
  const server = createServer(app);
  opts.storage.mount(app);
  app.use(staticDirMiddleware('/models', opts.modelsDir));
  mountMcp(app, { ...opts.mcp, origin: () => `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
  app.use((req, res, next) => {
    if (pathname(req) !== '/' || (req.method !== 'GET' && req.method !== 'HEAD')) {
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
  return server;
}

/** Studio storage and `/models`, with `/health` and `/ws` proxied to the realtime server. */
export function createPublicServer(opts: { storage: StudioStorage; modelsDir: string; realtimeTarget: string }): Server {
  const proxy = httpProxy.createProxyServer({ target: opts.realtimeTarget, changeOrigin: true });
  proxy.on('error', (err, _req, target) => {
    console.warn('[studio-server] realtime proxy:', err.message);
    if (target instanceof ServerResponse) {
      if (!target.headersSent) {
        target.writeHead(502);
      }
      target.end();
    } else {
      target.destroy();
    }
  });
  const app = connect();
  opts.storage.mount(app);
  app.use(staticDirMiddleware('/models', opts.modelsDir));
  app.use((req, res, next) => {
    if (pathname(req) === '/health') {
      proxy.web(req, res);
    } else {
      next();
    }
  });
  const server = createServer(app);
  server.on('upgrade', (req, socket, head) => {
    if (pathname(req) === '/ws') {
      proxy.ws(req, socket, head);
    } else {
      socket.destroy();
    }
  });
  return server;
}
