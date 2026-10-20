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
    pool ??= new pg.Pool({ connectionString: env.SUPABASE_DB_URL });
    const { rows } = await pool.query<Office>(
      `select id, name, description from offices ${id ? 'where id = $1' : ''} order by created_at`,
      id ? [id] : [],
    );
    return rows;
  };
  const { OFFICEXR_DEV_USER_LOGIN: login, OFFICEXR_DEV_USER_NAME: name } = env;

  return {
    assetsInclude: ['**/*.exr'],
    plugins: [
      react(),
      tailwindcss(),
      officexrServer({ queryOffices, devUser: login ? { login, name: name ?? login } : undefined, devEnv }),
    ],
    preview: {
      host: true,
      port: Number(process.env.PORT) || 4173,
      allowedHosts: true,
    },
  };
});
