import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import connect from 'connect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MISSIONS_CHANGED_KIND, type Mission } from '@officexr/sdk';
import { missionsMiddleware } from './missions';
import { createMemoryMissions, MAX_OPEN_MISSIONS } from './missionsStore';
import type { Office } from './shared';

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const office = (id: string): Office => ({ id, name: 'HQ', description: null, map_name: 'hq', created_by_login: null, debug_enabled: false });

let server: Server | undefined;
afterEach(() => server?.close());

async function start() {
  const clock = { value: Date.parse('2026-11-20T10:00:00Z') };
  const store = createMemoryMissions(() => (clock.value += 1000));
  const presence = { notifyLogin: vi.fn(() => true), notifyOffice: vi.fn(() => true) };
  const app = connect();
  app.use(
    missionsMiddleware({
      identity: (req) => {
        const login = req.headers['x-test-login'];
        return typeof login === 'string' ? { login, name: login } : null;
      },
      queryOffices: async (id) => (id && [ID, OTHER_ID].includes(id.toLowerCase()) ? [office(id.toLowerCase())] : []),
      missions: store,
      presence,
    }),
  );
  app.use((_req, res) => {
    res.statusCode = 404;
    res.end('fell through');
  });
  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (login: string | null, method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { ...(login ? { 'x-test-login': login } : {}), 'content-type': 'application/json' },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text.startsWith('{') ? (JSON.parse(text) as { mission?: Mission; missions?: Mission[]; error?: string }) : undefined };
  };
  const create = async (login: string, body: unknown, officeId = ID) => (await call(login, 'POST', `/api/offices/${officeId}/missions`, body)).body!.mission!;
  const list = async (login: string, officeId = ID) => (await call(login, 'GET', `/api/offices/${officeId}/missions`)).body!.missions!;
  return { call, create, list, presence, store, base };
}

const path = (officeId: string, missionId = '') => `/api/offices/${officeId}/missions${missionId && `/${missionId}`}`;
const plain = { steps: [], place: null, dueAt: null, personLogin: null, shared: false };

describe('missions routes', () => {
  it('passes other paths on', async () => {
    const h = await start();
    expect((await h.call('a', 'GET', '/api/offices')).status).toBe(404);
    expect((await h.call('a', 'GET', `/api/offices/${ID}/props`)).status).toBe(404);
  });

  it('needs a signed-in user and an existing office', async () => {
    const h = await start();
    expect((await h.call(null, 'GET', path(ID))).status).toBe(401);
    expect((await h.call('a', 'GET', path('not-a-uuid'))).status).toBe(404);
    expect((await h.call('a', 'GET', path('33333333-3333-4333-8333-333333333333'))).status).toBe(404);
    expect((await h.call('a', 'PUT', path(ID))).status).toBe(405);
  });

  it('answers 415 to a body that is not application/json, on POST and PATCH', async () => {
    const h = await start();
    const mission = await h.create('a', { title: 'x' });
    const raw = (method: string, url: string, type: string) =>
      fetch(`${h.base}${url}`, { method, headers: { 'x-test-login': 'a', 'content-type': type }, body: JSON.stringify({ title: 'y' }) });
    expect((await raw('POST', path(ID), 'text/plain')).status).toBe(415);
    expect((await raw('PATCH', path(ID, mission.id), 'application/x-www-form-urlencoded')).status).toBe(415);
    expect((await raw('POST', path(ID), 'application/json; charset=utf-8')).status).toBe(201);
    expect((await h.list('a')).map((m) => m.title)).toEqual(['y', 'x']);
  });

  it('creates with defaults and returns 201', async () => {
    const h = await start();
    const res = await h.call('a', 'POST', path(ID), { title: '  Ship it  ' });
    expect(res.status).toBe(201);
    expect(res.body!.mission).toMatchObject({ officeId: ID, ownerLogin: 'a', source: 'mine', title: 'Ship it', ...plain, done: false });
  });

  it('rejects bad input', async () => {
    const h = await start();
    const bad = [
      {},
      { title: '' },
      { title: 'x'.repeat(141) },
      { title: 't', steps: Array.from({ length: 21 }, () => ({ text: 's', done: false })) },
      { title: 't', dueAt: 'tomorrow' },
      { title: 't', place: { kind: 'garage', id: 'x', label: 'x' } },
    ];
    for (const body of bad) {
      expect((await h.call('a', 'POST', path(ID), body)).status).toBe(400);
    }
    expect((await h.call('a', 'POST', path(ID), '{nope')).status).toBe(400);
    expect((await h.call('a', 'POST', path(ID), { title: 'x'.repeat(40_000) })).status).toBe(413);
    const m = await h.create('a', { title: 't' });
    expect((await h.call('a', 'PATCH', path(ID, m.id), { title: '' })).status).toBe(400);
  });

  it('accepts a title of exactly 140 characters and 20 steps', async () => {
    const h = await start();
    const res = await h.call('a', 'POST', path(ID), { title: 'x'.repeat(140), steps: Array.from({ length: 20 }, () => ({ text: 's', done: false })) });
    expect(res.status).toBe(201);
  });

  it('lists own and shared missions of the office, open ones newest first, done ones last', async () => {
    const h = await start();
    const first = await h.create('a', { title: 'first' });
    const shared = await h.create('b', { title: 'shared by b', shared: true });
    await h.create('b', { title: 'private to b' });
    await h.create('a', { title: 'elsewhere' }, OTHER_ID);
    await h.create('a', { title: 'third' });
    await h.call('a', 'PATCH', path(ID, first.id), { done: true });
    expect((await h.list('a')).map((m) => m.title)).toEqual(['third', 'shared by b', 'first']);
    expect((await h.list('b')).map((m) => m.title)).toEqual(['private to b', 'shared by b']);
    expect((await h.list('c')).map((m) => m.id)).toEqual([shared.id]);
  });

  it('lets the owner edit every field and delete', async () => {
    const h = await start();
    const m = await h.create('a', { title: 'one' });
    const place = { kind: 'room', id: 'r1', label: 'Lounge' };
    const res = await h.call('a', 'PATCH', path(ID, m.id), { title: 'two', steps: [{ text: 's', done: true }], place, dueAt: '2026-12-01T09:00:00.000Z', personLogin: 'b', shared: true, done: true });
    expect(res.status).toBe(200);
    expect(res.body!.mission).toMatchObject({ title: 'two', steps: [{ text: 's', done: true }], place, dueAt: '2026-12-01T09:00:00.000Z', personLogin: 'b', shared: true, done: true });
    expect((await h.call('a', 'PATCH', path(ID, m.id), { place: null })).body!.mission!.place).toBeNull();
    expect((await h.call('a', 'DELETE', path(ID, m.id))).status).toBe(204);
    expect(await h.list('a')).toEqual([]);
    expect((await h.call('a', 'DELETE', path(ID, m.id))).status).toBe(404);
  });

  it('lets others set only done on a shared mission', async () => {
    const h = await start();
    const shared = await h.create('a', { title: 'shared', shared: true });
    const priv = await h.create('a', { title: 'private' });
    expect((await h.call('b', 'PATCH', path(ID, shared.id), { done: true })).body!.mission!.done).toBe(true);
    expect((await h.call('b', 'PATCH', path(ID, shared.id), { done: true, title: 'mine now' })).status).toBe(403);
    expect((await h.call('b', 'PATCH', path(ID, shared.id), { title: 'mine now' })).status).toBe(403);
    expect((await h.call('b', 'PATCH', path(ID, shared.id), {})).status).toBe(403);
    expect((await h.call('b', 'PATCH', path(ID, shared.id), { shared: false })).status).toBe(403);
    expect((await h.call('b', 'PATCH', path(ID, priv.id), { done: true })).status).toBe(404);
    expect((await h.call('b', 'DELETE', path(ID, priv.id))).status).toBe(404);
    expect((await h.call('b', 'DELETE', path(ID, shared.id))).status).toBe(403);
    expect((await h.list('a')).find((m) => m.id === shared.id)!.title).toBe('shared');
  });

  it('404s an unknown or foreign-office mission', async () => {
    const h = await start();
    const m = await h.create('a', { title: 'one' });
    expect((await h.call('a', 'PATCH', path(ID, 'nope'), { done: true })).status).toBe(404);
    expect((await h.call('a', 'PATCH', path(OTHER_ID, m.id), { done: true })).status).toBe(404);
    expect((await h.call('a', 'DELETE', path(OTHER_ID, m.id))).status).toBe(404);
    expect((await h.call('a', 'GET', path(ID, m.id))).status).toBe(405);
  });

  it('caps open missions per owner per office and frees a slot when one is done', async () => {
    const h = await start();
    for (let i = 0; i < MAX_OPEN_MISSIONS; i++) {
      await h.store.create(ID, 'a', { title: `m${i}`, ...plain });
    }
    expect((await h.call('a', 'POST', path(ID), { title: 'over' })).status).toBe(409);
    expect((await h.call('b', 'POST', path(ID), { title: 'other owner' })).status).toBe(201);
    expect((await h.call('a', 'POST', path(OTHER_ID), { title: 'other office' })).status).toBe(201);
    const [one] = await h.list('a');
    await h.call('a', 'PATCH', path(ID, one.id), { done: true });
    expect((await h.call('a', 'POST', path(ID), { title: 'fits now' })).status).toBe(201);
    expect((await h.call('a', 'PATCH', path(ID, one.id), { done: false })).status).toBe(409);
  });
});

describe('missions hardening', () => {
  it('refuses a done toggle that raced an unshare, inside the store', async () => {
    const h = await start();
    const m = await h.create('a', { title: 'was shared', shared: true });
    await h.call('a', 'PATCH', path(ID, m.id), { shared: false, title: 'secret now' });
    expect(await h.store.update(ID, m.id, 'b', { done: true })).toBeUndefined();
    expect((await h.store.get(ID, m.id))!.done).toBe(false);
  });

  it('refuses a stale non-owner edit of other fields inside the store', async () => {
    const h = await start();
    const m = await h.create('a', { title: 'shared', shared: true });
    expect(await h.store.update(ID, m.id, 'b', { done: true, title: 'x' })).toBeUndefined();
  });

  it('rejects blank, invisible, NUL and out-of-range text', async () => {
    const h = await start();
    const bad = [
      { title: '​' },
      { title: ' ​⁠ ' },
      { title: 'a\u0000b' },
      { title: 't', steps: [{ text: '   ', done: false }] },
      { title: 't', steps: [{ text: 'a\u0000', done: false }] },
      { title: 't', personLogin: 'x'.repeat(201) },
      { title: 't', dueAt: '0000-01-01T00:00:00Z' },
      { title: 't', dueAt: '1969-12-31T23:59:59Z' },
    ];
    for (const body of bad) {
      expect((await h.call('a', 'POST', path(ID), body)).status).toBe(400);
    }
    const ok = await h.call('a', 'POST', path(ID), { title: 't', steps: [{ text: '  step  ', done: false }], personLogin: 'x'.repeat(200) });
    expect(ok.body!.mission!.steps[0].text).toBe('step');
  });

  it('notifies with the canonical office id, not the url text', async () => {
    const h = await start();
    await h.call('a', 'POST', path(ID.toUpperCase()), { title: 't', shared: true });
    expect(h.presence.notifyOffice).toHaveBeenCalledWith(ID, MISSIONS_CHANGED_KIND, { officeId: ID });
  });
});

describe('missions realtime notify', () => {
  it('tells only the owner about a private mission', async () => {
    const h = await start();
    const m = await h.create('a', { title: 'p' });
    await h.call('a', 'PATCH', path(ID, m.id), { done: true });
    await h.call('a', 'DELETE', path(ID, m.id));
    expect(h.presence.notifyLogin).toHaveBeenCalledTimes(3);
    expect(h.presence.notifyLogin).toHaveBeenCalledWith(ID, 'a', MISSIONS_CHANGED_KIND, { officeId: ID });
    expect(h.presence.notifyOffice).not.toHaveBeenCalled();
  });

  it('tells the whole office about a shared mission, including a non-owner ticking it', async () => {
    const h = await start();
    const m = await h.create('a', { title: 's', shared: true });
    await h.call('b', 'PATCH', path(ID, m.id), { done: true });
    await h.call('a', 'DELETE', path(ID, m.id));
    expect(h.presence.notifyOffice).toHaveBeenCalledTimes(3);
    expect(h.presence.notifyOffice).toHaveBeenCalledWith(ID, MISSIONS_CHANGED_KIND, { officeId: ID });
    expect(h.presence.notifyLogin).not.toHaveBeenCalled();
  });

  it('tells the office when a mission stops being shared', async () => {
    const h = await start();
    const m = await h.create('a', { title: 's', shared: true });
    h.presence.notifyOffice.mockClear();
    await h.call('a', 'PATCH', path(ID, m.id), { shared: false });
    expect(h.presence.notifyOffice).toHaveBeenCalledOnce();
  });

  it('does not notify on a refused or invalid write', async () => {
    const h = await start();
    const m = await h.create('a', { title: 's', shared: true });
    h.presence.notifyOffice.mockClear();
    await h.call('b', 'PATCH', path(ID, m.id), { title: 'x' });
    await h.call('b', 'DELETE', path(ID, m.id));
    await h.call('a', 'POST', path(ID), {});
    expect(h.presence.notifyOffice).not.toHaveBeenCalled();
    expect(h.presence.notifyLogin).not.toHaveBeenCalled();
  });
});

describe('in-memory missions store', () => {
  it('ignores patch keys it does not know', async () => {
    const store = createMemoryMissions();
    const created = await store.create(ID, 'a', { title: 't', ...plain });
    if (created === 'limit') throw new Error('unexpected');
    const patch = JSON.parse('{"title":"new","__proto__":{"ownerLogin":"evil"},"ownerLogin":"evil","id":"x"}');
    const updated = await store.update(ID, created.id, 'a', patch);
    expect(updated).toMatchObject({ id: created.id, ownerLogin: 'a', title: 'new' });
  });

  it('returns undefined for a missing mission and false when removing one', async () => {
    const store = createMemoryMissions();
    expect(await store.get(ID, 'x')).toBeUndefined();
    expect(await store.update(ID, 'x', 'a', { done: true })).toBeUndefined();
    expect(await store.remove(ID, 'x')).toBe(false);
  });
});
