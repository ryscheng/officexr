import {
  FilesystemBakedLayoutStorage,
  FilesystemCatalogStorage,
  FilesystemLayoutStorage,
  FilesystemMapStorage,
  FilesystemRoomStorage,
  FilesystemWorldConstantsStorage,
} from '@officexr/world/scenes';
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';
import { HeavyWorkLock } from './heavy-work-lock.ts';
import { createChromiumRenderer } from './renderer.ts';
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

/**
 * The POST handler mounts from the post hook so Vite's host check runs first; the 405 stays in front
 * so the SPA fallback can't answer a GET.
 */
function mountMcp(
  { middlewares, httpServer }: Pick<ViteDevServer | PreviewServer, 'middlewares' | 'httpServer'>,
  options: StudioMcpOptions,
) {
  middlewares.use('/mcp', (req, res, next) => {
    if (req.method === 'POST') {
      next();
      return;
    }
    res.statusCode = 405;
    res.setHeader('allow', 'POST');
    res.end();
  });
  return () => middlewares.use('/mcp', async (req, res) => {
    try {
      // Read per request: the port is only known once the server is listening.
      const address = httpServer?.address();
      if (!address || typeof address === 'string') {
        throw new Error('server is not listening on a TCP port');
      }
      const origin = `http://127.0.0.1:${address.port}`;
      await handleMcpRequest(loopbackDocuments(origin), options, origin, req, res);
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
export default function studioMcpPlugin({
  modelRoot,
  chromiumPath,
}: Pick<StudioMcpOptions, 'modelRoot'> & {
  /** Chromium that `render_view` launches; Playwright's own download when unset. */
  chromiumPath?: string;
}): Plugin {
  const options: StudioMcpOptions = {
    modelRoot,
    heavyWorkLock: new HeavyWorkLock('a bake or render'),
    renderer: createChromiumRenderer({ executablePath: chromiumPath }),
  };
  return {
    name: 'officexr:studio-mcp',
    configureServer: (server) => mountMcp(server, options),
    configurePreviewServer: (server) => mountMcp(server, options),
  };
}
