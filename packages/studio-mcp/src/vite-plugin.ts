import type { Plugin, PreviewServer, ViteDevServer } from 'vite';
import { createStudioMcpOptions, loopbackOrigin, mcpMethodGuard, mcpPostHandler } from './mount-mcp.ts';
import type { StudioMcpOptions } from './server.ts';

/** The POST handler mounts from the post hook so Vite's host check runs first; the guard stays in front. */
function mountOnVite(
  { middlewares, httpServer }: Pick<ViteDevServer | PreviewServer, 'middlewares' | 'httpServer'>,
  options: StudioMcpOptions,
) {
  middlewares.use('/mcp', mcpMethodGuard);
  const post = mcpPostHandler({
    ...options,
    origin: () => loopbackOrigin(httpServer),
  });
  return () => middlewares.use('/mcp', post);
}

/** Mounts the studio's MCP server at `POST /mcp` on the dev and preview servers. */
export default function studioMcpPlugin(mcpOptions: Parameters<typeof createStudioMcpOptions>[0]): Plugin {
  const options = createStudioMcpOptions(mcpOptions);
  return {
    name: 'officexr:studio-mcp',
    configureServer: (server) => mountOnVite(server, options),
    // Mounted up front: with a non-root `base`, preview's base middleware 404s everything the post hook adds.
    configurePreviewServer: (server) => {
      mountOnVite(server, options)();
    },
  };
}
