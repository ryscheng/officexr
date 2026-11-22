import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import studioStorage, { createStudioStorage } from '@officexr/world/vite-plugin-storage';

// The web SPA with no backend: no database, no sign-in, no realtime server. The map, room and object
// catalog come from the checked-in studio data, the models from the studio's public dir, and
// `/hud-preview` (src/hud-preview/) joins an in-memory office. Used by the HUD Playwright specs and Ladle.
const emptyConfig = (_req: unknown, res: { setHeader(k: string, v: string): void; end(b: string): void }) => {
  res.setHeader('Content-Type', 'text/javascript');
  res.end('');
};

export default defineConfig(() => {
  process.env.VITE_API_ORIGIN = '';
  return {
    publicDir: fileURLToPath(new URL('../studio/public', import.meta.url)),
    plugins: [
      react(),
      tailwindcss(),
      studioStorage(),
      {
        name: 'officexr:hud-preview-in-build',
        enforce: 'pre',
        apply: 'build',
        transform(code, id) {
          if (!id.endsWith('/src/main.tsx')) return null;
          const open = code.replace('import.meta.env.DEV && window.location.pathname', 'window.location.pathname');
          if (open === code) this.error('src/main.tsx no longer gates /hud-preview on import.meta.env.DEV');
          return open;
        },
      },
      {
        name: 'officexr:empty-config',
        configureServer(server) {
          server.middlewares.use('/config.js', emptyConfig);
        },
        async configurePreviewServer(server) {
          const storage = createStudioStorage();
          await storage.migrate();
          storage.mount(server.middlewares);
          server.middlewares.use('/config.js', emptyConfig);
        },
      },
    ],
    server: { port: 5176, strictPort: true, host: true },
    preview: { port: Number(process.env.HUD_PORT ?? 5176), strictPort: true, host: true },
    resolve: process.env.HUD_PROFILING ? { alias: { 'react-dom/client': 'react-dom/profiling' } } : undefined,
    build: { outDir: process.env.HUD_OUT ?? 'dist/hud-preview', minify: process.env.HUD_PROFILING ? false : undefined },
  };
});
