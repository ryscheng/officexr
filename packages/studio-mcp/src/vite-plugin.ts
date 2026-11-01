import type { Plugin, PreviewServer, ViteDevServer } from 'vite';
import { HeavyWorkLock } from './heavy-work-lock.ts';
import { BakeJobs } from './tools/bake-jobs.ts';
import { createChromiumRenderer } from './renderer.ts';
import { mcpMethodGuard, mcpPostHandler } from './mount-mcp.ts';
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
    bakeJobs: new BakeJobs(),
  };
  return {
    name: 'officexr:studio-mcp',
    configureServer: (server) => mountOnVite(server, options),
    configurePreviewServer: (server) => mountOnVite(server, options),
  };
}
