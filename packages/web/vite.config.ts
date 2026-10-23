import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import pg from 'pg';
import { officexrServer, type CreateOffice, type Office, type OfficeCharacters, type OfficeUpdate, type UpdateOffice } from './server/api';

export default defineConfig(({ mode }) => {
  const devEnv = loadEnv(mode, __dirname, '');
  const env = { ...devEnv, ...process.env };
  let pool: pg.Pool | undefined;
  const getPool = () => {
    if (!env.SUPABASE_DB_URL) {
      throw new Error('SUPABASE_DB_URL is not set');
    }
    if (!pool) {
      pool = new pg.Pool({ connectionString: env.SUPABASE_DB_URL });
      pool.on('error', (err) => console.error(err));
    }
    return pool;
  };
  const officeColumns = 'id, name, description, map_name, created_by_login, debug_enabled';
  const queryOffices = async (id?: string) => {
    const { rows } = await getPool().query<Office>(
      `select ${officeColumns} from offices ${id ? 'where id = $1' : ''} order by created_at`,
      id ? [id] : [],
    );
    return rows;
  };
  const createOffice: CreateOffice = async ({ name, description, mapName, createdByLogin }) => {
    const { rows } = await getPool().query<Office>(
      `insert into offices (name, description, map_name, created_by_login) values ($1, $2, $3, $4) returning ${officeColumns}`,
      [name, description, mapName, createdByLogin],
    );
    return rows[0];
  };
  const updateColumns: Record<keyof OfficeUpdate, string> = {
    name: 'name',
    description: 'description',
    mapName: 'map_name',
    debugEnabled: 'debug_enabled',
  };
  const updateOffice: UpdateOffice = async (id, update) => {
    const entries = Object.entries(update) as [keyof OfficeUpdate, unknown][];
    const { rows } = await getPool().query<Office>(
      `update offices set ${entries.map(([key], i) => `${updateColumns[key]} = $${i + 2}`).join(', ')} where id = $1 returning ${officeColumns}`,
      [id, ...entries.map(([, value]) => value)],
    );
    return rows[0];
  };
  const characters: OfficeCharacters = {
    get: async (officeId, login) => {
      const { rows } = await getPool().query<{ character_id: string }>(
        'select character_id from office_characters where office_id = $1 and user_login = $2',
        [officeId, login],
      );
      return rows[0]?.character_id ?? null;
    },
    set: async (officeId, login, characterId) => {
      await getPool().query(
        `insert into office_characters (office_id, user_login, character_id) values ($1, $2, $3)
         on conflict (office_id, user_login) do update set character_id = excluded.character_id, updated_at = now()`,
        [officeId, login, characterId],
      );
    },
  };
  const closePool = () => {
    const closing = pool;
    pool = undefined;
    closing?.end().catch((err) => console.error(err));
  };
  const { OFFICEXR_DEV_USER_LOGIN: login, OFFICEXR_DEV_USER_NAME: name } = env;
  const realtimeTarget = env.REALTIME_SERVER_TARGET ?? 'http://127.0.0.1:8787';

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
      officexrServer({
        queryOffices,
        characters,
        createOffice,
        updateOffice,
        devUser: login ? { login, name: name ?? login } : undefined,
        devEnv,
        studioDataDir: env.OFFICEXR_STUDIO_DATA_DIR,
        modelsDir: fileURLToPath(new URL('../studio/public/models', import.meta.url)),
      }),
    ],
    // Preview inherits this proxy.
    server: {
      proxy: {
        '/ws': { target: realtimeTarget, changeOrigin: true, ws: true },
        '/health': { target: realtimeTarget, changeOrigin: true },
      },
    },
    preview: {
      host: true,
      port: Number(process.env.PORT) || 4173,
      allowedHosts: true,
    },
  };
});
