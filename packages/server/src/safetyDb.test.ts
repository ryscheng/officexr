import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_BLOCKS } from '@officexr/sdk';
import { createDb } from './db';

// Opt-in: needs a Postgres with the `offices` table and migration 027 applied, e.g.
// DB_URL=postgres://postgres@localhost/officexr pnpm --filter @officexr/server test
const url = process.env.DB_URL;

describe.skipIf(!url)('user_blocks and user_reports in Postgres', () => {
  const db = createDb(url);
  const admin = new pg.Client({ connectionString: url });
  const owner = `owner-${Date.now()}`;

  beforeAll(() => admin.connect());
  afterAll(async () => {
    await admin.query('delete from user_blocks where blocker_login like $1', [`${owner}%`]);
    await admin.query('delete from user_reports where reporter_login like $1', [`${owner}%`]);
    await admin.end();
    await db.close();
  });

  it('round-trips a block with its name, lists it, keeps one row per person and removes it', async () => {
    const a = `${owner}-a`;
    expect(await db.blocks.add(a, 'bob@x.io', 'Bob')).toBe('ok');
    expect(await db.blocks.add(a, 'bob@x.io', null)).toBe('ok');
    expect(await db.blocks.list(a)).toEqual([{ login: 'bob@x.io', name: 'Bob' }]);
    await db.blocks.remove(a, 'bob@x.io');
    expect(await db.blocks.list(a)).toEqual([]);
  });

  it('refuses a block of oneself in the table', async () => {
    await expect(admin.query("insert into user_blocks (blocker_login, blocked_login) values ('x', 'x')")).rejects.toThrow();
  });

  it('stops at the limit under concurrent adds and still updates a listed person', async () => {
    const b = `${owner}-b`;
    await admin.query(`insert into user_blocks (blocker_login, blocked_login) select $1, 'p' || g from generate_series(1, $2::int) g`, [b, MAX_BLOCKS - 1]);
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => db.blocks.add(b, `race${i}`, null)));
    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect(await db.blocks.add(b, 'p1', 'Renamed')).toBe('ok');
    expect((await db.blocks.list(b)).find((p) => p.login === 'p1')?.name).toBe('Renamed');
  });

  it('stores a report, with or without an office, and enforces the reason and note limits', async () => {
    const reporter = `${owner}-r`;
    await db.reports.add({ officeId: null, reporter, reported: 'bob@x.io', reason: 'spam', note: null });
    const { rows: office } = await admin.query("insert into offices (name, map_name) values ('report test', 'default') returning id");
    await db.reports.add({ officeId: office[0].id, reporter, reported: 'bob@x.io', reason: 'harassment', note: 'rude' });
    const { rows } = await admin.query('select reason, note, office_id, resolved_at from user_reports where reporter_login = $1 order by created_at', [reporter]);
    expect(rows.map((r) => [r.reason, r.note, r.resolved_at])).toEqual([['spam', null, null], ['harassment', 'rude', null]]);
    await expect(db.reports.add({ officeId: null, reporter, reported: 'b', reason: 'because' as 'spam', note: null })).rejects.toThrow();
    await expect(db.reports.add({ officeId: null, reporter, reported: 'b', reason: 'spam', note: 'x'.repeat(501) })).rejects.toThrow();
    await admin.query('delete from offices where id = $1', [office[0].id]);
    expect((await admin.query('select count(*)::int as n from user_reports where reporter_login = $1', [reporter])).rows[0].n).toBe(2);
  });
});
