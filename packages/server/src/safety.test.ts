import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import connect from 'connect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_BLOCKS, type NetEvent } from '@officexr/sdk';
import { RealtimeServer } from '@officexr/realtime-server/server';
import { WsChannel } from '@officexr/realtime-server';
import { safetyMiddleware } from './safety';
import { createMemoryBlocks, createMemoryReports } from './safetyStore';

const OFFICE = '11111111-1111-4111-8111-111111111111';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function start(realtime: { refreshBlocks: (login: string) => Promise<void> } = { refreshBlocks: vi.fn(async () => undefined) }, now?: () => number) {
  const blocks = createMemoryBlocks();
  const reports = createMemoryReports();
  const app = connect();
  app.use(
    safetyMiddleware({
      identity: (req) => {
        const login = req.headers['x-test-login'];
        return typeof login === 'string' ? { login, name: login } : null;
      },
      blocks,
      reports,
      realtime,
      now,
    }),
  );
  app.use((_req, res) => {
    res.statusCode = 404;
    res.end('fell through');
  });
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (login: string | null, method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { ...(login ? { 'x-test-login': login } : {}), 'content-type': 'application/json' },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text.startsWith('{') ? (JSON.parse(text) as Record<string, unknown>) : undefined };
  };
  return { call, blocks, reports, realtime, base };
}

describe('GET /api/social', () => {
  it('lists what this server supports without a sign-in', async () => {
    const h = await start();
    expect(await h.call(null, 'GET', '/api/social')).toEqual({ status: 200, body: { block: true, report: true, nearbyChat: true, directChat: true } });
    expect((await h.call(null, 'POST', '/api/social')).status).toBe(405);
  });

  it('passes other paths on', async () => {
    const h = await start();
    expect((await h.call('a', 'GET', '/api/offices')).status).toBe(404);
  });
});

describe('blocks', () => {
  it('needs a sign-in', async () => {
    const h = await start();
    expect((await h.call(null, 'GET', '/api/blocks')).status).toBe(401);
    expect((await h.call(null, 'PUT', '/api/blocks/b')).status).toBe(401);
    expect((await h.call(null, 'POST', '/api/reports', {})).status).toBe(401);
  });

  it('blocks, lists with the name, refreshes the live rooms, and unblocks', async () => {
    const h = await start();
    const put = await h.call('a@x.io', 'PUT', `/api/blocks/${encodeURIComponent('b@x.io')}`, { name: '  Bob  ' });
    expect(put).toEqual({ status: 200, body: { blocks: [{ login: 'b@x.io', name: 'Bob' }] } });
    expect(h.realtime.refreshBlocks).toHaveBeenCalledWith('a@x.io');
    expect((await h.call('a@x.io', 'GET', '/api/blocks')).body).toEqual({ blocks: [{ login: 'b@x.io', name: 'Bob' }] });
    expect((await h.call('b@x.io', 'GET', '/api/blocks')).body).toEqual({ blocks: [] });
    const del = await h.call('a@x.io', 'DELETE', `/api/blocks/${encodeURIComponent('b@x.io')}`);
    expect(del.body).toEqual({ blocks: [] });
    expect(h.realtime.refreshBlocks).toHaveBeenCalledTimes(2);
  });

  it('keeps one row when the same person is blocked twice, and accepts a block without a name', async () => {
    const h = await start();
    await h.call('a', 'PUT', '/api/blocks/b', { name: 'Bob' });
    await h.call('a', 'PUT', '/api/blocks/b', {});
    expect((await h.call('a', 'GET', '/api/blocks')).body!.blocks).toHaveLength(1);
    expect((await h.call('a', 'PUT', '/api/blocks/c')).body!.blocks).toHaveLength(2);
  });

  it('refuses to block oneself, a session id, or an overlong login', async () => {
    const h = await start();
    expect((await h.call('a', 'PUT', '/api/blocks/a')).status).toBe(400);
    expect((await h.call('a', 'PUT', `/api/blocks/${encodeURIComponent('b#session')}`)).status).toBe(400);
    expect((await h.call('a', 'PUT', `/api/blocks/${'x'.repeat(201)}`)).status).toBe(400);
    expect((await h.call('a', 'PUT', '/api/blocks/%E0%A4%A')).status).toBe(400);
    expect((await h.call('a', 'GET', '/api/blocks')).body!.blocks).toEqual([]);
  });

  it('stops at the block limit but still lets a listed person be updated', async () => {
    const h = await start();
    for (let i = 0; i < MAX_BLOCKS; i++) {
      await h.blocks.add('a', `p${i}`, null);
    }
    expect((await h.call('a', 'PUT', '/api/blocks/one-more')).status).toBe(409);
    expect((await h.call('a', 'PUT', '/api/blocks/p0', { name: 'P' })).status).toBe(200);
  });

  it('rejects other methods and an oversized body', async () => {
    const h = await start();
    expect((await h.call('a', 'POST', '/api/blocks')).status).toBe(405);
    expect((await h.call('a', 'POST', '/api/blocks/b')).status).toBe(405);
    expect((await h.call('a', 'PUT', '/api/blocks/b', { name: 'x'.repeat(10_000) })).status).toBe(413);
  });
});

describe('reports', () => {
  const report = { officeId: OFFICE, login: 'b@x.io', reason: 'harassment', note: '  rude in chat  ' };

  it('stores the report with the reporter taken from the session', async () => {
    const h = await start();
    expect((await h.call('a@x.io', 'POST', '/api/reports', report)).status).toBe(201);
    expect(h.reports.all).toEqual([{ officeId: OFFICE, reporter: 'a@x.io', reported: 'b@x.io', reason: 'harassment', note: 'rude in chat' }]);
  });

  it('keeps an optional note and office out when missing or malformed', async () => {
    const h = await start();
    await h.call('a', 'POST', '/api/reports', { login: 'b', reason: 'spam', officeId: 'not-a-uuid', note: '   ' });
    expect(h.reports.all[0]).toMatchObject({ officeId: null, note: null, reason: 'spam' });
  });

  it('rejects a reason outside the list, free text without a reason, a long note, oneself, and a session id', async () => {
    const h = await start();
    const bad = [
      { ...report, reason: 'because' },
      { login: 'b@x.io', note: 'only text' },
      { ...report, note: 'x'.repeat(501) },
      { ...report, login: 'a@x.io' },
      { ...report, login: 'b@x.io#1' },
      {},
    ];
    for (const body of bad) {
      expect((await h.call('a@x.io', 'POST', '/api/reports', body)).status).toBe(400);
    }
    expect((await h.call('a@x.io', 'POST', '/api/reports', '{nope')).status).toBe(400);
    expect(h.reports.all).toEqual([]);
  });

  it('limits repeat reports of one person and bursts from one reporter, then allows them later', async () => {
    const clock = { value: 0 };
    const h = await start(undefined, () => clock.value);
    expect((await h.call('a', 'POST', '/api/reports', { login: 'b', reason: 'spam' })).status).toBe(201);
    expect((await h.call('a', 'POST', '/api/reports', { login: 'c', reason: 'spam' })).status).toBe(429);
    clock.value += 6_000;
    expect((await h.call('a', 'POST', '/api/reports', { login: 'b', reason: 'spam' })).status).toBe(429);
    expect((await h.call('a', 'POST', '/api/reports', { login: 'c', reason: 'spam' })).status).toBe(201);
    clock.value += 61_000;
    expect((await h.call('a', 'POST', '/api/reports', { login: 'b', reason: 'spam' })).status).toBe(201);
    expect(h.reports.all).toHaveLength(3);
  });
});

describe('blocks against a live realtime server', () => {
  it('hides each side from the other when the block is made over HTTP, and shows them again on unblock', async () => {
    const realtime = new RealtimeServer({ port: 0, blocks: { blockedBy: async (login) => (await h.blocks.list(login)).map((p) => p.login) } });
    await realtime.start();
    cleanups.push(() => realtime.stop());
    const h = await start(realtime);
    const open = async (userId: string) => {
      const channel = new WsChannel({ url: `ws://127.0.0.1:${realtime.boundPort}/ws`, userId, officeId: 'o1' });
      cleanups.push(() => channel.close());
      const events: NetEvent[] = [];
      const left: string[] = [];
      channel.on((e) => events.push(e));
      channel.onPresenceChange((_j, l) => left.push(...l));
      await channel.subscribe();
      channel.trackPresence({});
      return { channel, events, left };
    };
    const chat = (actorId: string, text: string): NetEvent => ({ v: 1, actorId, seq: Math.floor(Math.random() * 1e6), t: Date.now(), kind: 'chat:message', text });
    const settle = () => new Promise((r) => setTimeout(r, 150));
    const ann = await open('ann@x.io');
    const bob = await open('bob@x.io');
    await settle();

    await h.call('ann@x.io', 'PUT', `/api/blocks/${encodeURIComponent('bob@x.io')}`, { name: 'Bob' });
    await settle();
    expect(ann.left).toEqual(['bob@x.io']);
    expect(bob.left).toEqual(['ann@x.io']);
    await bob.channel.send(chat('bob@x.io', 'hello?'));
    await settle();
    expect(ann.events.filter((e) => e.kind === 'chat:message')).toEqual([]);

    await h.call('ann@x.io', 'DELETE', `/api/blocks/${encodeURIComponent('bob@x.io')}`);
    await settle();
    await bob.channel.send(chat('bob@x.io', 'back'));
    await settle();
    expect(ann.events.filter((e) => e.kind === 'chat:message')).toHaveLength(1);
  });
});
