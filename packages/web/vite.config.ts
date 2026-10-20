import { defineConfig, loadEnv, type Connect } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { RUNTIME_CONFIG_KEYS } from '../core/src/lib/runtime-config-keys';

// packages/core/src is one level up from packages/web
const coreRoot = path.resolve(__dirname, '../core/src');

/** Serves `/config.js` from env at request time so one build can be configured per deployment. */
function configJsMiddleware(extraEnv: Record<string, string> = {}): Connect.NextHandleFunction {
  return (req, res, next) => {
    if (req.url?.split('?')[0] !== '/config.js') {
      return next();
    }
    const env = { ...extraEnv, ...process.env };
    const config = Object.fromEntries(
      RUNTIME_CONFIG_KEYS.filter((key) => env[key] !== undefined).map((key) => [key, env[key]]),
    );
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Cache-Control', 'no-store');
    res.end(`window.__OFFICEXR_CONFIG__ = ${JSON.stringify(config)};`);
  };
}

export default defineConfig(({ mode }) => ({
  assetsInclude: ['**/*.exr'],
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'officexr-runtime-config',
      configureServer: (server) => {
        server.middlewares.use(configJsMiddleware(loadEnv(mode, __dirname, 'VITE_')));
      },
      configurePreviewServer: (server) => {
        server.middlewares.use(configJsMiddleware());
      },
    },
  ],
  preview: {
    host: true,
    port: Number(process.env.PORT) || 4173,
    allowedHosts: true,
  },
  resolve: {
    alias: [
      // @/* resolves to packages/core/src — covers all web + shared imports.
      { find: '@', replacement: coreRoot },
    ],
  },
}));
