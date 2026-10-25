import type { AddressInfo } from 'node:net';
import {
  FilesystemCatalogStorage,
  FilesystemLayoutStorage,
  FilesystemMapStorage,
  FilesystemRoomStorage,
  FilesystemWorldConstantsStorage,
} from '@officexr/world/scenes';
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';
import { handleMcpRequest } from './server.ts';
import type { StudioDocuments } from './studio-documents.ts';

/** Clients for the studio's own REST surface, so validation, hooks and disk I/O stay in `vite-plugin-storage.ts`. */
function loopbackDocuments(origin: string): StudioDocuments {
  return {
    rooms: new FilesystemRoomStorage({ basePath: `${origin}/api/rooms` }),
    maps: new FilesystemMapStorage({ basePath: `${origin}/api/maps` }),
    layouts: new FilesystemLayoutStorage({ basePath: `${origin}/api/layouts` }),
    catalog: new FilesystemCatalogStorage({ basePath: `${origin}/api/world-object-kinds` }),
    worldSettings: new FilesystemWorldConstantsStorage({ basePath: `${origin}/api/world-settings` }),
  };
}

function mountMcp({ middlewares, httpServer }: Pick<ViteDevServer | PreviewServer, 'middlewares' | 'httpServer'>) {
  middlewares.use('/mcp', async (req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.setHeader('allow', 'POST');
      res.end();
      return;
    }
    try {
      // Read per request: the port is only known once the server is listening.
      const { port } = httpServer?.address() as AddressInfo;
      await handleMcpRequest(loopbackDocuments(`http://127.0.0.1:${port}`), req, res);
    } catch (err) {
      console.error('[studio-mcp] request failed:', err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null }));
      }
    }
  });
}

/** Mounts the studio's MCP server at `POST /mcp` on the dev and preview servers. */
export default function studioMcpPlugin(): Plugin {
  return {
    name: 'officexr:studio-mcp',
    configureServer: mountMcp,
    configurePreviewServer: mountMcp,
  };
}
