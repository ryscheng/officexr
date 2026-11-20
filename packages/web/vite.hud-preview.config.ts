import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import studioStorage from '@officexr/world/vite-plugin-storage';

// The web SPA with no backend: no database, no sign-in, no realtime server. The map, room and object
// catalog come from the checked-in studio data, the models from the studio's public dir, and
// `/hud-preview` (src/hud-preview/) joins an in-memory office. Used by the HUD Playwright specs and Ladle.
export default defineConfig(() => {
  process.env.VITE_API_ORIGIN = '';
  return {
    publicDir: fileURLToPath(new URL('../studio/public', import.meta.url)),
    plugins: [
      react(),
      tailwindcss(),
      studioStorage(),
      {
        name: 'officexr:empty-config',
        configureServer(server) {
          server.middlewares.use('/config.js', (_req, res) => {
            res.setHeader('Content-Type', 'text/javascript');
            res.end('');
          });
        },
      },
    ],
    server: { port: 5176, strictPort: true, host: true },
  };
});
