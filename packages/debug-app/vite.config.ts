import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
  plugins: [react()],
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
