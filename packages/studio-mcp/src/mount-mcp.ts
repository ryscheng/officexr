import {
  FilesystemBakedLayoutStorage,
  FilesystemCatalogStorage,
  FilesystemLayoutStorage,
  FilesystemMapStorage,
  FilesystemRoomStorage,
  FilesystemWorldConstantsStorage,
} from '@officexr/world/scenes';
import type { NodeMiddleware, StudioStorageApp } from '@officexr/world/vite-plugin-storage';
import { handleMcpRequest, type StudioMcpOptions } from './server.ts';
import type { StudioDocuments } from './studio-documents.ts';

/** Clients for the studio's own REST surface, so validation, hooks and disk I/O stay in `vite-plugin-storage.ts`. */
function loopbackDocuments(origin: string): StudioDocuments {
  return {
    rooms: new FilesystemRoomStorage({ basePath: `${origin}/api/rooms` }),
    maps: new FilesystemMapStorage({ basePath: `${origin}/api/maps` }),
    layouts: new FilesystemLayoutStorage({ basePath: `${origin}/api/layouts` }),
    catalog: new FilesystemCatalogStorage({ basePath: `${origin}/api/world-object-kinds` }),
    worldSettings: new FilesystemWorldConstantsStorage({ basePath: `${origin}/api/world-settings` }),
    bakedLayouts: new FilesystemBakedLayoutStorage({ basePath: `${origin}/api/baked-layouts` }),
  };
}

export type McpApp = StudioStorageApp;

export type McpOptions = StudioMcpOptions & {
  /** Loopback and render origin, read per request: the port is only known once the server is listening. */
  origin: () => string;
};

/** 405s everything but POST, so a host's SPA fallback can't answer a GET. */
export const mcpMethodGuard: NodeMiddleware = (req, res, next) => {
  if (req.method === 'POST') {
    next();
    return;
  }
  res.statusCode = 405;
  res.setHeader('allow', 'POST');
  res.end();
};

export function mcpPostHandler(options: McpOptions): NodeMiddleware {
  return async (req, res) => {
    try {
      const origin = options.origin();
      await handleMcpRequest(loopbackDocuments(origin), options, origin, req, res);
    } catch (err) {
      console.error('[studio-mcp] request failed:', err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null }));
      }
    }
  };
}

/** Mounts `POST /mcp` on any connect-style app. */
export function mountMcp(app: McpApp, options: McpOptions): void {
  app.use('/mcp', mcpMethodGuard);
  app.use('/mcp', mcpPostHandler(options));
}
