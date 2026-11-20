import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from './db';
import { MAX_OPEN_MISSIONS } from './missionsStore';

// Opt-in: needs a Postgres with the `offices` table and migration 026 applied, e.g.
// DB_URL=postgres://postgres@localhost/officexr pnpm --filter @officexr/server test
const url = process.env.DB_URL;

describe.skipIf(!url)('office_missions in Postgres', () => {
  const db = createDb(url);
  const admin = new pg.Client({ connectionString: url });
  const offices: string[] = [];
  const newOffice = async () => {
    const { rows } = await admin.query('insert into offices (name, map_name) values ($1, $2) returning id', ['db test', 'default']);
    offices.push(rows[0].id);
    return rows[0].id as string;
  };
  const input = (title: string, shared = false) => ({ title, steps: [{ text: 's', done: false }], place: null, dueAt: null, personLogin: null, shared });

  beforeAll(() => admin.connect());
  afterAll(async () => {
    for (const id of offices) await admin.query('delete from offices where id = $1', [id]);
    await admin.end();
    await db.close();
  });

  it('round-trips a mission, lists own and shared open-first, and round-trips done', async () => {
    const office = await newOffice();
    const a = await db.missions.create(office, 'a', { ...input('one'), place: { kind: 'room', id: 'r', label: 'R' }, dueAt: '2026-12-01T09:00:00.000Z' });
    if (a === 'limit') throw new Error('unexpected');
    expect(a).toMatchObject({ ownerLogin: 'a', source: 'mine', dueAt: '2026-12-01T09:00:00.000Z', place: { kind: 'room', id: 'r', label: 'R' }, steps: [{ text: 's', done: false }] });
    await db.missions.create(office, 'b', input('shared', true));
    await db.missions.create(office, 'b', input('private'));
    await db.missions.update(office, a.id, 'a', { done: true });
    expect((await db.missions.list(office, 'a')).map((m) => m.title)).toEqual(['shared', 'one']);
    await db.missions.update(office, a.id, 'a', { done: false, place: null, steps: [] });
    expect(await db.missions.get(office, a.id)).toMatchObject({ done: false, place: null, steps: [] });
  });

  it('refuses a non-owner update once the mission is private, under the row lock', async () => {
    const office = await newOffice();
    const m = await db.missions.create(office, 'a', input('s', true));
    if (m === 'limit') throw new Error('unexpected');
    expect(await db.missions.update(office, m.id, 'b', { done: true })).toMatchObject({ done: true });
    await db.missions.update(office, m.id, 'a', { shared: false });
    expect(await db.missions.update(office, m.id, 'b', { done: false })).toBeUndefined();
    expect(await db.missions.update(office, m.id, 'a', { done: false })).toMatchObject({ done: false });
  });

  it('has check constraints for title, source and person length', async () => {
    const office = await newOffice();
    const insert = (cols: string, vals: unknown[]) =>
      admin.query(`insert into office_missions (office_id, owner_login, ${cols}) values ($1, 'a', ${vals.map((_, i) => `$${i + 2}`).join(', ')})`, [office, ...vals]);
    await expect(insert('title', [''])).rejects.toThrow();
    await expect(insert('title', ['x'.repeat(141)])).rejects.toThrow();
    await expect(insert('title, source', ['t', 'fax'])).rejects.toThrow();
    await expect(insert('title, person_login', ['t', 'x'.repeat(201)])).rejects.toThrow();
  });

  it('keeps an owner at the open limit when many creates race', async () => {
    const office = await newOffice();
    await admin.query(`insert into office_missions (office_id, owner_login, title) select $1, 'a', 'm' || g from generate_series(1, $2::int) g`, [office, MAX_OPEN_MISSIONS - 1]);
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => db.missions.create(office, 'a', input(`race${i}`))));
    expect(results.filter((r) => r !== 'limit')).toHaveLength(1);
  });

  it('removes and reports a missing row', async () => {
    const office = await newOffice();
    const m = await db.missions.create(office, 'a', input('x'));
    if (m === 'limit') throw new Error('unexpected');
    expect(await db.missions.remove(office, m.id)).toBe(true);
    expect(await db.missions.remove(office, m.id)).toBe(false);
    expect(await db.missions.update(office, m.id, 'a', { done: true })).toBeUndefined();
  });
});
