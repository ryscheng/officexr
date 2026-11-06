import pg from 'pg';
import type { CreateOffice, OfficeCharacters, OfficeDeskClaims, QueryOffices, UpdateOffice } from './api';
import { pgAllowlist, pgSessionStore, type IsLoginAllowed } from './auth';
import type { Office, OfficeUpdate } from './shared';

const UNIQUE_VIOLATION = '23505';
const DESK_PRIMARY_KEY = 'office_desk_claims_pkey';

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
  const deskClaims: OfficeDeskClaims = {
    list: async (officeId) => {
      const { rows } = await getPool().query<{ desk_id: string; user_login: string }>(
        'select desk_id, user_login from office_desk_claims where office_id = $1',
        [officeId],
      );
      return Object.fromEntries(rows.map((row) => [row.desk_id, row.user_login]));
    },
    claim: async (officeId, login, deskId) => {
      const client = await getPool().connect();
      try {
        await client.query('begin');
        await client.query('delete from office_desk_claims where office_id = $1 and user_login = $2', [officeId, login]);
        await client.query('insert into office_desk_claims (office_id, desk_id, user_login) values ($1, $2, $3)', [officeId, deskId, login]);
        await client.query('commit');
        return 'ok';
      } catch (err) {
        await client.query('rollback');
        const { code, constraint } = err as pg.DatabaseError;
        if (code === UNIQUE_VIOLATION && constraint === DESK_PRIMARY_KEY) {
          return 'taken';
        }
        throw err;
      } finally {
        client.release();
      }
    },
    release: async (officeId, login) => {
      await getPool().query('delete from office_desk_claims where office_id = $1 and user_login = $2', [officeId, login]);
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
    deskClaims,
    isLoginAllowed,
    sessionStore: () => pgSessionStore(getPool()),
    close,
  };
}
