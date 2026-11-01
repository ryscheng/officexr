import pg from 'pg';
import type { CreateOffice, OfficeCharacters, QueryOffices, UpdateOffice } from './api';
import { pgAllowlist, pgSessionStore, type IsLoginAllowed } from './auth';
import type { Office, OfficeUpdate } from './shared';

/** The Postgres-backed callbacks `createApp` takes. The pool connects on first query, so an unset URL only fails then. */
export function createDb(connectionString: string | undefined) {
  let pool: pg.Pool | undefined;
  const getPool = () => {
    if (!connectionString) {
      throw new Error('SUPABASE_DB_URL is not set');
    }
    if (!pool) {
      pool = new pg.Pool({ connectionString });
      pool.on('error', (err) => console.error(err));
    }
    return pool;
  };
  const officeColumns = 'id, name, description, map_name, created_by_login, debug_enabled';
  const queryOffices: QueryOffices = async (id) => {
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
  const isLoginAllowed: IsLoginAllowed = (email) => pgAllowlist(getPool(), 'login_allowlist')(email);
  const close = async () => {
    const closing = pool;
    pool = undefined;
    await closing?.end();
  };
  return {
    queryOffices,
    createOffice,
    updateOffice,
    characters,
    isLoginAllowed,
    sessionStore: () => pgSessionStore(getPool()),
    close,
  };
}
