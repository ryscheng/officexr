import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_PLACED_PROPS } from '@officexr/sdk';
import { createDb } from './db';

// Opt-in: needs a Postgres with the `offices` table and migration 024 applied, e.g.
// DB_URL=postgres://postgres@localhost/officexr pnpm --filter @officexr/server test
const url = process.env.DB_URL;

describe.skipIf(!url)('office_props in Postgres', () => {
  const db = createDb(url);
  const admin = new pg.Client({ connectionString: url });
  const offices: string[] = [];
  const newOffice = async () => {
    const { rows } = await admin.query('insert into offices (name, map_name) values ($1, $2) returning id', ['db test', 'default']);
    offices.push(rows[0].id);
    return rows[0].id as string;
  };
  const prop = (i: number) => ({ id: `placed:t-${i}`, kindId: 'prop_pool' as const, position: [i, 4, 0] as [number, number, number], yawDeg: 0 });

  beforeAll(() => admin.connect());
  afterAll(async () => {
    for (const id of offices) await admin.query('delete from offices where id = $1', [id]);
    await admin.end();
    await db.close();
  });

  it('keeps an office at the limit when many adds race at one below it', async () => {
    const office = await newOffice();
    for (let i = 0; i < MAX_PLACED_PROPS - 1; i++) expect(await db.placedProps.add(office, prop(i), 'seed')).toBe('ok');
    await Promise.all(Array.from({ length: 10 }, () => db.placedProps.list(office)));
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => db.placedProps.add(office, prop(100 + i), `u${i}`)));
    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect(await db.placedProps.list(office)).toHaveLength(MAX_PLACED_PROPS);
  });

  it('adds, updates and removes, and refuses what is not there', async () => {
    const office = await newOffice();
    expect(await db.placedProps.add(office, prop(1), 'a')).toBe('ok');
    expect(await db.placedProps.update(office, { ...prop(1), yawDeg: 90 })).toBe('ok');
    expect(await db.placedProps.update(office, prop(2))).toBe('not-found');
    expect((await db.placedProps.list(office))[0]).toMatchObject({ yawDeg: 90 });
    expect(await db.placedProps.remove(office, prop(1).id)).toBe('ok');
    expect(await db.placedProps.remove(office, prop(1).id)).toBe('not-found');
  });

  it('rejects a turn that is not a quarter turn and a kind outside the curated set', async () => {
    const office = await newOffice();
    const insert = (kind: string, yaw: number) =>
      admin.query('insert into office_props (office_id, id, kind_id, x, y, z, yaw_deg) values ($1, $2, $3, 0, 0, 0, $4)', [office, `placed:c-${kind}-${yaw}`, kind, yaw]);
    await expect(insert('prop_pool', 45)).rejects.toThrow(/check/);
    await expect(insert('cube', 0)).rejects.toThrow(/check/);
    await expect(insert('prop_pool', 270)).resolves.toBeDefined();
  });
});
