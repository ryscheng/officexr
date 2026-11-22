import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import connect from 'connect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiMiddleware } from './api';
import { LOOKUPS_PER_WINDOW, officeLookupMiddleware } from './officeLookup';
import type { Office } from './shared';

const ID = '11111111-1111-4111-8111-111111111111';
const office: Office = { id: ID, name: 'Design studio', description: 'private notes', map_name: 'hq', created_by_login: 'owner@example.com', debug_enabled: true };

let server: Server | undefined;
afterEach(() => server?.close());

async function start(clock = { value: 0 }) {
  const queryOffices = vi.fn(async (id?: string) => (id === ID ? [office] : []));
  const app = connect();
  app.use(officeLookupMiddleware({ queryOffices, now: () => clock.value }));
  app.use((_req, res) => {
    res.statusCode = 404;
    res.end('fell through');
  });
  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = async (id: string, headers: Record<string, string> = {}) => {
    const res = await fetch(`${base}/api/offices/${id}/name`, { headers });
    return { status: res.status, headers: res.headers, text: await res.text() };
  };
  return { get, queryOffices, base, clock };
}

describe('office name lookup', () => {
  it('answers with the name only and needs no sign-in', async () => {
    const h = await start();
    const res = await h.get(ID);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.text)).toEqual({ name: 'Design studio' });
    expect(res.text).not.toMatch(/private notes|owner@example|hq|debug/);
  });

  it('answers 404 for an unknown office and for an id that is not a uuid, without a lookup for the latter', async () => {
    const h = await start();
    expect((await h.get('22222222-2222-4222-8222-222222222222')).status).toBe(404);
    expect((await h.get('not-a-uuid')).status).toBe(404);
    expect(h.queryOffices).toHaveBeenCalledTimes(1);
  });

  it('caches a name for a minute and a miss for ten seconds', async () => {
    const h = await start();
    await h.get(ID);
    await h.get(ID);
    expect(h.queryOffices).toHaveBeenCalledTimes(1);
    h.clock.value += 61_000;
    await h.get(ID);
    expect(h.queryOffices).toHaveBeenCalledTimes(2);
    const missing = '22222222-2222-4222-8222-222222222222';
    await h.get(missing);
    await h.get(missing);
    expect(h.queryOffices).toHaveBeenCalledTimes(3);
    h.clock.value += 11_000;
    await h.get(missing);
    expect(h.queryOffices).toHaveBeenCalledTimes(4);
  });

  it('limits one client and not another, and resets after the window', async () => {
    const h = await start();
    for (let i = 0; i < LOOKUPS_PER_WINDOW; i++) {
      expect((await h.get(ID, { 'x-forwarded-for': '203.0.113.7' })).status).toBe(200);
    }
    const blocked = await h.get(ID, { 'x-forwarded-for': '203.0.113.7' });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBe('60');
    expect((await h.get(ID, { 'x-forwarded-for': '203.0.113.8' })).status).toBe(200);
    h.clock.value += 61_000;
    expect((await h.get(ID, { 'x-forwarded-for': '203.0.113.7' })).status).toBe(200);
  });

  it('passes every other path on and refuses other methods', async () => {
    const h = await start();
    expect((await fetch(`${h.base}/api/offices/${ID}`)).status).toBe(404);
    expect((await fetch(`${h.base}/api/offices/${ID}/name`, { method: 'POST' })).status).toBe(405);
  });
});

describe('office name lookup next to the API', () => {
  it('is answered before the signed-in API, which would answer 401 or 404', async () => {
    const app = connect();
    app.use(officeLookupMiddleware({ queryOffices: async () => [office] }));
    app.use(
      apiMiddleware({
        queryOffices: async () => [office],
        identity: () => null,
      } as unknown as Parameters<typeof apiMiddleware>[0]),
    );
    server = createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    expect((await fetch(`${base}/api/offices/${ID}/name`)).status).toBe(200);
    expect((await fetch(`${base}/api/me`)).status).toBe(401);
  });
});
