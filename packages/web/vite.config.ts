import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import pg from 'pg';
import { officexrServer, type Office } from './server/api';

export default defineConfig(({ mode }) => {
  const devEnv = loadEnv(mode, __dirname, '');
  const env = { ...devEnv, ...process.env };
  let pool: pg.Pool | undefined;
  const queryOffices = async (id?: string) => {
    if (!env.SUPABASE_DB_URL) {
      throw new Error('SUPABASE_DB_URL is not set');
    }
    if (!pool) {
      pool = new pg.Pool({ connectionString: env.SUPABASE_DB_URL });
      pool.on('error', (err) => console.error(err));
    }
    const { rows } = await pool.query<Office>(
      `select id, name, description from offices ${id ? 'where id = $1' : ''} order by created_at`,
      id ? [id] : [],
    );
    return rows;
  };
  const closePool = () => {
    const closing = pool;
    pool = undefined;
    closing?.end().catch((err) => console.error(err));
  };
  const { OFFICEXR_DEV_USER_LOGIN: login, OFFICEXR_DEV_USER_NAME: name } = env;

  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'officexr-pool-close',
        configureServer: (server) => {
          server.httpServer?.on('close', closePool);
        },
        configurePreviewServer: (server) => {
          server.httpServer.on('close', closePool);
        },
      },
      officexrServer({ queryOffices, devUser: login ? { login, name: name ?? login } : undefined, devEnv }),
    ],
    preview: {
      host: true,
      port: Number(process.env.PORT) || 4173,
      allowedHosts: true,
    },
  };
});
