import type pg from 'pg';
import type { Mission, MissionPlace, MissionSource, MissionStep } from '@officexr/sdk';
import { MAX_OPEN_MISSIONS, mayPatch, patchedFields, type MissionsStore } from './missionsStore';

interface MissionRow {
  id: string;
  office_id: string;
  owner_login: string;
  source: MissionSource;
  title: string;
  steps: MissionStep[];
  place: MissionPlace | null;
  due_at: Date | null;
  person_login: string | null;
  shared: boolean;
  done: boolean;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = 'id, office_id, owner_login, source, title, steps, place, due_at, person_login, shared, done, created_at, updated_at';

const toMission = (row: MissionRow): Mission => ({
  id: row.id,
  officeId: row.office_id,
  source: row.source,
  ownerLogin: row.owner_login,
  title: row.title,
  steps: row.steps,
  place: row.place,
  dueAt: row.due_at?.toISOString() ?? null,
  personLogin: row.person_login,
  shared: row.shared,
  done: row.done,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

const PATCH_COLUMNS: Record<ReturnType<typeof patchedFields>[number], string> = {
  title: 'title',
  steps: 'steps',
  place: 'place',
  dueAt: 'due_at',
  personLogin: 'person_login',
  shared: 'shared',
  done: 'done',
};

const JSON_FIELDS = new Set<string>(['steps', 'place']);

export function pgMissions(getPool: () => pg.Pool): MissionsStore {
  const withOwnerLock = async <T>(officeId: string, owner: string, run: (client: pg.PoolClient) => Promise<T>): Promise<T> => {
    const client = await getPool().connect();
    try {
      await client.query('begin');
      // The count below runs under read committed, so concurrent creates for one owner must queue on this lock.
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`missions:${officeId}:${owner}`]);
      const result = await run(client);
      await client.query('commit');
      return result;
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  };
  const openCount = async (client: pg.PoolClient, officeId: string, owner: string) => {
    const { rows } = await client.query<{ n: number }>(
      'select count(*)::int as n from office_missions where office_id = $1 and owner_login = $2 and not done',
      [officeId, owner],
    );
    return rows[0].n;
  };
  return {
    list: async (officeId, login) => {
      const { rows } = await getPool().query<MissionRow>(
        `select ${COLUMNS} from office_missions where office_id = $1 and (owner_login = $2 or shared)
         order by done, created_at desc, id desc`,
        [officeId, login],
      );
      return rows.map(toMission);
    },
    get: async (officeId, id) => {
      const { rows } = await getPool().query<MissionRow>(`select ${COLUMNS} from office_missions where office_id = $1 and id = $2`, [officeId, id]);
      return rows[0] && toMission(rows[0]);
    },
    create: (officeId, owner, input) =>
      withOwnerLock(officeId, owner, async (client) => {
        if ((await openCount(client, officeId, owner)) >= MAX_OPEN_MISSIONS) {
          return 'limit';
        }
        const { rows } = await client.query<MissionRow>(
          `insert into office_missions (office_id, owner_login, title, steps, place, due_at, person_login, shared)
           values ($1, $2, $3, $4, $5, $6, $7, $8) returning ${COLUMNS}`,
          [officeId, owner, input.title, JSON.stringify(input.steps), input.place && JSON.stringify(input.place), input.dueAt, input.personLogin, input.shared],
        );
        return toMission(rows[0]);
      }),
    update: async (officeId, id, login, patch) => {
      const { rows: owners } = await getPool().query<{ owner_login: string }>('select owner_login from office_missions where office_id = $1 and id = $2', [officeId, id]);
      if (!owners[0]) {
        return undefined;
      }
      return withOwnerLock(officeId, owners[0].owner_login, async (client) => {
        const { rows: current } = await client.query<MissionRow>(`select ${COLUMNS} from office_missions where office_id = $1 and id = $2 for update`, [officeId, id]);
        if (!current[0] || !mayPatch({ ownerLogin: current[0].owner_login, shared: current[0].shared }, login, patch)) {
          return undefined;
        }
        if (patch.done === false && current[0].done && (await openCount(client, officeId, current[0].owner_login)) >= MAX_OPEN_MISSIONS) {
          return 'limit';
        }
        const present = patchedFields(patch);
        const sets = present.map((field, i) => `${PATCH_COLUMNS[field]} = $${i + 3}`);
        const values = present.map((field) => (JSON_FIELDS.has(field) && patch[field] !== null ? JSON.stringify(patch[field]) : patch[field]));
        const { rows } = await client.query<MissionRow>(
          `update office_missions set ${[...sets, 'updated_at = now()'].join(', ')} where office_id = $1 and id = $2 returning ${COLUMNS}`,
          [officeId, id, ...values],
        );
        return toMission(rows[0]);
      });
    },
    remove: async (officeId, id) => {
      const { rowCount } = await getPool().query('delete from office_missions where office_id = $1 and id = $2', [officeId, id]);
      return !!rowCount;
    },
  };
}
