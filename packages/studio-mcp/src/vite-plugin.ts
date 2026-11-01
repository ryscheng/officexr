import type { Plugin, PreviewServer, ViteDevServer } from 'vite';
import { createStudioMcpOptions, mcpMethodGuard, mcpPostHandler } from './mount-mcp.ts';
import type { StudioMcpOptions } from './server.ts';

/** The POST handler mounts from the post hook so Vite's host check runs first; the guard stays in front. */
function mountOnVite(
  { middlewares, httpServer }: Pick<ViteDevServer | PreviewServer, 'middlewares' | 'httpServer'>,
  options: StudioMcpOptions,
) {
  middlewares.use('/mcp', mcpMethodGuard);
  const post = mcpPostHandler({
    ...options,
    origin: () => {
      const address = httpServer?.address();
      if (!address || typeof address === 'string') {
        throw new Error('server is not listening on a TCP port');
      }
      return `http://127.0.0.1:${address.port}`;
    },
  });
  return () => middlewares.use('/mcp', post);
}

/** Mounts the studio's MCP server at `POST /mcp` on the dev and preview servers. */
export default function studioMcpPlugin(mcpOptions: Parameters<typeof createStudioMcpOptions>[0]): Plugin {
  const options = createStudioMcpOptions(mcpOptions);
  return {
    name: 'officexr:studio-mcp',
    configureServer: (server) => mountOnVite(server, options),
    configurePreviewServer: (server) => mountOnVite(server, options),
  };
}
