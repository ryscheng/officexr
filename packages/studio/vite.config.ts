import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import studioStorage from '@officexr/world/vite-plugin-storage';
import bots from '@officexr/world/vite-plugin-bots';

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

export default defineConfig({
  plugins: [
    react(),
    // Mounts the studio's authoring REST surface:
    //   /api/rooms      → packages/world/rooms/      (FilesystemRoomStorage)
    //   /api/maps       → packages/world/maps/       (FilesystemMapStorage)
    //   /api/cube-kinds → packages/world/cube-kinds.json (Object editor catalog; Task 3)
    //   /api/scenes     → packages/world/scenes/     (legacy back-compat for the
    //                                                 existing Scenes editor until Task 5)
    studioStorage(),
    // Spawns the Node bot CLI as a child process for the lifetime of
    // the dev server, so `pnpm dev:studio` is one-command. If you'd
    // rather run `pnpm bots:start` yourself in a second terminal, the
    // plugin probes the health endpoint first and skips spawning when
    // it sees an existing instance.
    //
    // OFFICE_ID must match `StudioPage.tsx`'s `OFFICE_ID` constant so
    // the spawned bots and the browser join the same WS office.
    bots({ env: { OFFICE_ID: 'studio-office' } }),
  ],
  server: {
    port: 5174,
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
});
