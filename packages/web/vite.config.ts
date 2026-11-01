import type { Server as HttpServer } from 'node:http';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { RealtimeServer } from '@officexr/realtime-server/server';
import { authConfigFromEnv, createApp, createDb, officeSessionPolicy } from '@officexr/server';

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
          const db = createDb(env.SUPABASE_DB_URL);
          const realtime = new RealtimeServer({
            tokenSecret: env.OFFICEXR_REALTIME_TOKEN_SECRET,
            sessionPolicy: officeSessionPolicy(db.queryOffices),
          });
          const app = await createApp({
            ...db,
            auth: authConfigFromEnv(env),
            realtime,
            realtimeTokenSecret: env.OFFICEXR_REALTIME_TOKEN_SECRET,
            studioDataDir: env.OFFICEXR_STUDIO_DATA_DIR,
            dev: { user: login ? { login, name: name ?? login } : undefined, env: devEnv },
          });
          server.middlewares.use(app);
          const { httpServer } = server;
          if (httpServer) {
            // Vite only hands out an HTTP/2 server when `server.https` is set, which this config never does.
            realtime.attach(httpServer as HttpServer);
            httpServer.on('close', () => {
              realtime.stop().catch((err) => console.error(err));
              db.close().catch((err) => console.error(err));
            });
          }
        },
      },
    ],
  };
});
