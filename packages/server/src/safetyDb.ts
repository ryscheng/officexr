import type pg from 'pg';
import { MAX_BLOCKS } from '@officexr/sdk';
import type { BlocksStore, ReportsStore } from './safetyStore';

export function pgBlocks(getPool: () => pg.Pool): BlocksStore {
  return {
    list: async (blocker) => {
      const { rows } = await getPool().query<{ blocked_login: string; blocked_name: string | null }>(
        'select blocked_login, blocked_name from user_blocks where blocker_login = $1 order by created_at, blocked_login',
        [blocker],
      );
      return rows.map((row) => ({ login: row.blocked_login, name: row.blocked_name }));
    },
    add: async (blocker, blocked, name) => {
      const client = await getPool().connect();
      try {
        await client.query('begin');
        await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`blocks:${blocker}`]);
        const { rowCount } = await client.query(
          `insert into user_blocks (blocker_login, blocked_login, blocked_name)
           select $1, $2, $3
           where exists (select 1 from user_blocks where blocker_login = $1 and blocked_login = $2)
              or (select count(*) from user_blocks where blocker_login = $1) < $4
           on conflict (blocker_login, blocked_login) do update set blocked_name = coalesce(excluded.blocked_name, user_blocks.blocked_name)`,
          [blocker, blocked, name, MAX_BLOCKS],
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
    remove: async (blocker, blocked) => {
      await getPool().query('delete from user_blocks where blocker_login = $1 and blocked_login = $2', [blocker, blocked]);
    },
  };
}

export function pgReports(getPool: () => pg.Pool): ReportsStore {
  return {
    add: async ({ officeId, reporter, reported, reason, note }) => {
      await getPool().query(
        'insert into user_reports (office_id, reporter_login, reported_login, reason, note) values ($1, $2, $3, $4, $5)',
        [officeId, reporter, reported, reason, note],
      );
    },
  };
}
