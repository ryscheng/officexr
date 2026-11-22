import pg from 'pg';
import { MAX_PLACED_PROPS, type PlacedProp, type PlaceableKindId } from '@officexr/sdk';
import type { CreateOffice, OfficeCharacters, OfficeDeskClaims, OfficePlacedProps, QueryOffices, UpdateOffice } from './api';
import type { CalendarLinks } from './calendarService';
import { pgAllowlist, pgSessionStore, type IsLoginAllowed } from './auth';
import { pgMissions } from './missionsDb';
import { pgBlocks, pgReports } from './safetyDb';
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
    claimants: async (officeId) => {
      const { rows } = await getPool().query<{ user_login: string; character_id: string | null; claimed_at: Date | null }>(
        `select c.user_login, ch.character_id, c.claimed_at
         from office_desk_claims c
         left join office_characters ch on ch.office_id = c.office_id and ch.user_login = c.user_login
         where c.office_id = $1`,
        [officeId],
      );
      return Object.fromEntries(
        rows.map((row) => [
          row.user_login,
          {
            ...(row.character_id ? { characterId: row.character_id } : {}),
            ...(row.claimed_at ? { claimedAt: row.claimed_at.toISOString() } : {}),
          },
        ]),
      );
    },
    claim: async (officeId, login, deskId) => {
      try {
        await getPool().query(
          `insert into office_desk_claims (office_id, desk_id, user_login) values ($1, $2, $3)
           on conflict (office_id, user_login) do update set desk_id = excluded.desk_id, claimed_at = now()`,
          [officeId, deskId, login],
        );
        return 'ok';
      } catch (err) {
        const { code, constraint } = err as pg.DatabaseError;
        if (code === UNIQUE_VIOLATION && constraint === DESK_PRIMARY_KEY) {
          return 'taken';
        }
        throw err;
      }
    },
    release: async (officeId, login) => {
      await getPool().query('delete from office_desk_claims where office_id = $1 and user_login = $2', [officeId, login]);
    },
  };
  const propColumns = 'id, kind_id, x, y, z, yaw_deg';
  type PropRow = { id: string; kind_id: string; x: number; y: number; z: number; yaw_deg: number };
  const placedProps: OfficePlacedProps = {
    list: async (officeId) => {
      const { rows } = await getPool().query<PropRow>(`select ${propColumns} from office_props where office_id = $1 order by created_at, id`, [officeId]);
      return rows.map((r): PlacedProp => ({ id: r.id, kindId: r.kind_id as PlaceableKindId, position: [r.x, r.y, r.z], yawDeg: r.yaw_deg }));
    },
    add: async (officeId, prop, placedBy) => {
      const client = await getPool().connect();
      try {
        await client.query('begin');
        // The office row lock makes concurrent adds count one after another; under read committed the count alone would let them all pass.
        await client.query('select 1 from offices where id = $1 for update', [officeId]);
        const { rowCount } = await client.query(
          `insert into office_props (office_id, id, kind_id, x, y, z, yaw_deg, placed_by)
           select $1, $2, $3, $4, $5, $6, $7, $8
           where (select count(*) from office_props where office_id = $1) < $9`,
          [officeId, prop.id, prop.kindId, ...prop.position, prop.yawDeg, placedBy, MAX_PLACED_PROPS],
        );
        await client.query('commit');
        return rowCount ? 'ok' : 'limit';
      } catch (err) {
        await client.query('rollback').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    update: async (officeId, prop) => {
      const { rowCount } = await getPool().query(
        'update office_props set x = $3, y = $4, z = $5, yaw_deg = $6 where office_id = $1 and id = $2',
        [officeId, prop.id, ...prop.position, prop.yawDeg],
      );
      return rowCount ? 'ok' : 'not-found';
    },
    remove: async (officeId, id) => {
      const { rowCount } = await getPool().query('delete from office_props where office_id = $1 and id = $2', [officeId, id]);
      return rowCount ? 'ok' : 'not-found';
    },
  };
  const calendarLinks: CalendarLinks = {
    getMany: async (logins) => {
      const { rows } = await getPool().query<{ login: string; refresh_token_enc: string }>(
        'select login, refresh_token_enc from calendar_links where login = any($1)',
        [logins],
      );
      return Object.fromEntries(rows.map((row) => [row.login, row.refresh_token_enc]));
    },
    set: async (login, sealed) => {
      await getPool().query(
        `insert into calendar_links (login, refresh_token_enc) values ($1, $2)
         on conflict (login) do update set refresh_token_enc = excluded.refresh_token_enc, updated_at = now()`,
        [login, sealed],
      );
    },
    remove: async (login, onlySealed) => {
      const { rows } = await getPool().query<{ refresh_token_enc: string }>(
        'delete from calendar_links where login = $1 and ($2::text is null or refresh_token_enc = $2) returning refresh_token_enc',
        [login, onlySealed ?? null],
      );
      return rows[0]?.refresh_token_enc ?? null;
    },
  };
  const isLoginAllowed: IsLoginAllowed = (email) => pgAllowlist(getPool(), 'login_allowlist')(email);
  const query = (text: string) => getPool().query<{ version: string }>(text);
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
    placedProps,
    missions: pgMissions(getPool),
    blocks: pgBlocks(getPool),
    reports: pgReports(getPool),
    calendarLinks,
    isLoginAllowed,
    sessionStore: () => pgSessionStore(getPool()),
    query,
    close,
  };
}
