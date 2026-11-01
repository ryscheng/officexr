import { Server as HttpServer } from 'node:http';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createBackend } from '@officexr/server';

// The package scripts load this with `--configLoader runner`: the default loader leaves workspace
// packages to Node's type stripping, which can't parse `@officexr/realtime-server`'s parameter properties.
export default defineConfig(({ mode }) => {
  const devEnv = loadEnv(mode, import.meta.dirname, '');
  const env = { ...devEnv, ...process.env };
  const { OFFICEXR_DEV_USER_LOGIN: login, OFFICEXR_DEV_USER_NAME: name } = env;

  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'officexr-server',
        configureServer: async (server) => {
          const { app, realtime, closePool } = await createBackend(env, {
            dev: { user: login ? { login, name: name ?? login } : undefined, env: devEnv },
            worldConstantsUrl: env.OFFICEXR_WORLD_CONSTANTS_URL,
          });
          server.middlewares.use(app);
          const { httpServer } = server;
          // Vite hands out an HTTP/2 server only when `server.https` is set; realtime attaches to HTTP/1 only.
          if (httpServer instanceof HttpServer) {
            realtime.attach(httpServer);
            httpServer.on('close', () => {
              realtime.stop().catch((err) => console.error(err));
              closePool().catch((err) => console.error(err));
            });
          }
        },
      },
    ],
  };
});
