import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import studioStorage, { seedDataDir } from '@officexr/world/vite-plugin-storage';
import studioMcp from '@officexr/studio-mcp';
import bots from '@officexr/world/vite-plugin-bots';
import { studioBackend } from '@officexr/studio-server/studio-backend';

/**
 * The custom realtime server (`@officexr/realtime-server`, started by
 * `pnpm bots:start`) listens on 127.0.0.1:8787 of the *Vite host*.
 * When you're developing remotely (browser on your laptop, Vite + the
 * realtime server on a remote box) the browser can't reach 127.0.0.1
 * itself, so we proxy `/ws` and `/health` through the Vite dev server.
 *
 * The browser's WsChannel uses `${window.location.origin}/ws` as its
 * WebSocket URL by default, so all traffic rides the same connection
 * the page was served over.
 */
const REALTIME_TARGET =
  process.env.REALTIME_SERVER_TARGET ?? 'http://127.0.0.1:8787';

const backend = studioBackend(process.env);
const PUBLIC_DIR = fileURLToPath(new URL('./public', import.meta.url));

export default defineConfig(({ command }) => ({
  // Only builds move to /studio/: in dev, Vite's base middleware would 404 root /models and /mcp.
  base: command === 'build' ? '/studio/' : '/',
  plugins: [
    react(),
    tailwindcss(),
    // Mounts the studio's authoring REST surface (OFFICEXR_STUDIO_DATA_DIR moves
    // every path below under that dir):
    //   /api/rooms      → packages/world/rooms/      (FilesystemRoomStorage)
    //   /api/maps       → packages/world/maps/       (FilesystemMapStorage)
    //   /api/world-object-kinds → packages/world/world-object-kinds.json (Object editor catalog; Task 3)
    //   /api/world-settings → packages/world/world-settings.json (saved world constants; pushed to realtime servers)
    //   /api/scenes     → packages/world/scenes/     (legacy back-compat for the
    //                                                 existing Scenes editor until Task 5)
    studioStorage(backend.storageOptions),
    studioMcp({ modelRoot: PUBLIC_DIR, chromiumPath: process.env.OFFICEXR_RENDER_CHROMIUM_PATH || undefined }),
    {
      name: 'officexr:seed-data-dir',
      async configureServer() {
        if (backend.dataDir) {
          await seedDataDir(backend.dataDir);
        }
        await backend.ensureUploadedModelsDir();
      },
    },
    // Registered directly (not in a returned callback) so it runs ahead of Vite's public dir, like the servers.
    {
      name: 'officexr:uploaded-models',
      configureServer(server) {
        server.middlewares.use(backend.uploadedModelsMiddleware);
      },
    },
    // After the seed, so the sync sees seeded layouts and the uploaded dir exists.
    {
      name: 'officexr:r2-publish',
      configureServer: backend.startR2Sync,
    },
    // Spawns the Node bot CLI as a child process for the lifetime of
    // the dev server, so `pnpm dev:studio` is one-command. If you'd
    // rather run `pnpm bots:start` yourself in a second terminal, the
    // plugin probes the health endpoint first and skips spawning when
    // it sees an existing instance.
    //
    // OFFICE_ID must match `StudioPage.tsx`'s `OFFICE_ID` constant so
    // the spawned bots and the browser join the same WS office.
    bots({
      env: (server) => ({
        OFFICE_ID: 'studio-office',
        OFFICEXR_WORLD_CONSTANTS_URL: `http://127.0.0.1:${server.config.server.port}/api/world-settings`,
        OFFICEXR_REALTIME_ADMIN_TOKEN: backend.adminToken,
      }),
      onSpawn: (baseUrl) => backend.pushTargets.add(baseUrl),
    }),
  ],
  server: {
    port: 5174,
    // The spawned bot server reads this server's settings by port, so it must not move.
    strictPort: true,
    host: true, // listen on 0.0.0.0 so remote browsers can reach the dev server
    proxy: {
      '/ws': {
        target: REALTIME_TARGET,
        changeOrigin: true,
        ws: true,
        secure: false,
      },
      '/health': {
        target: REALTIME_TARGET,
        changeOrigin: true,
        secure: false,
      },
    },
  },
}));
