import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DESK_CLAIM_RESULT_KIND, type DeskClaimResult, type NetEvent } from '@officexr/sdk';
import { verifyJoinToken } from '../join-token.ts';
import { createOfficeApi } from '../office-api.ts';
import { RealtimeServer } from '../server.ts';
import { WsChannel } from '../ws-channel.ts';

const SECRET = 'api-secret';
const DESKS = new Set(['d1', 'd2']);

/** The backend's desk-claim routes over an in-memory table; `down` makes every request 503. */
async function startBackend(): Promise<{ url: string; stop: () => Promise<void>; setDown: (down: boolean) => void; calls: string[] }> {
  const claims: Record<string, string> = {};
  const calls: string[] = [];
  let down = false;
  const server: Server = createServer((req, res) => {
    const login = verifyJoinToken(SECRET, (req.headers.authorization ?? '').replace('Bearer ', ''), Date.now(), 'api')?.login;
    const route = /^\/api\/offices\/([^/]+)\/desk-claims(\/me)?$/.exec(req.url ?? '');
    if (down || !login || !route) {
      res.writeHead(down ? 503 : 404).end();
      return;
    }
    calls.push(`${req.method} ${route[1]}`);
    const reply = (status: number, body?: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(body && JSON.stringify(body));
    const release = () => {
      for (const desk of Object.keys(claims)) {
        if (claims[desk] === login) {
          delete claims[desk];
        }
      }
    };
    if (req.method === 'GET') {
      reply(200, { claims });
    } else if (req.method === 'DELETE') {
      release();
      reply(200, { claims });
    } else {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const { deskId } = JSON.parse(body) as { deskId: string };
        if (!DESKS.has(deskId)) {
          reply(400);
        } else if (claims[deskId] && claims[deskId] !== login) {
          reply(409);
        } else {
          release();
          claims[deskId] = login;
          reply(200, { claims });
        }
      });
    }
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    stop: () => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(() => resolve()));
    },
    setDown: (value) => {
      down = value;
    },
    calls,
  };
}

const claimsIn = (events: NetEvent[]): Record<string, string>[] => events.flatMap((e) => (e.kind === 'desk:claims' ? [e.claims] : []));

describe('desk claims through the realtime server', () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0).reverse()) {
      await c();
    }
  });

  async function setup(apiUp = true) {
    const backend = await startBackend();
    cleanups.push(backend.stop);
    const server = new RealtimeServer({
      port: 0,
      deskClaims: apiUp ? createOfficeApi({ baseUrl: backend.url, tokenSecret: SECRET }) : undefined,
    });
    await server.start();
    cleanups.push(() => server.stop());

    async function join(userId: string, officeId = 'o1') {
      const channel = new WsChannel({ url: `ws://127.0.0.1:${server.boundPort}/ws`, userId, officeId });
      cleanups.push(() => channel.close());
      const events: NetEvent[] = [];
      const results: DeskClaimResult[] = [];
      channel.on((e) => events.push(e));
      channel.onCustom(DESK_CLAIM_RESULT_KIND, (p) => results.push(p as DeskClaimResult));
      await channel.subscribe();
      return { channel, events, results, claim: (deskId: string | null) => channel.sendCustom('desk:claim', { deskId }) };
    }
    return { backend, join };
  }

  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  it('claims, moves and releases, converging both clients and a late joiner', async () => {
    const { join } = await setup();
    const ann = await join('ann');
    const bob = await join('bob');

    ann.claim('d1');
    await vi.waitFor(() => expect(claimsIn(bob.events).at(-1)).toEqual({ d1: 'ann' }));
    expect(ann.results).toEqual([{ ok: true }]);
    expect(claimsIn(ann.events).at(-1)).toEqual({ d1: 'ann' });

    ann.claim('d2');
    await vi.waitFor(() => expect(claimsIn(bob.events).at(-1)).toEqual({ d2: 'ann' }));

    const late = await join('cat');
    expect(claimsIn(late.events)).toEqual([{ d2: 'ann' }]);

    ann.claim(null);
    await vi.waitFor(() => expect(claimsIn(late.events).at(-1)).toEqual({}));
  });

  it('answers a taken or unknown desk to the sender only, without a broadcast', async () => {
    const { join } = await setup();
    const ann = await join('ann');
    const bob = await join('bob');
    ann.claim('d1');
    await vi.waitFor(() => expect(claimsIn(bob.events)).toHaveLength(2));

    bob.claim('d1');
    bob.claim('nope');
    await vi.waitFor(() =>
      expect(bob.results).toEqual([
        { ok: false, error: 'taken' },
        { ok: false, error: 'unknown-desk' },
      ]),
    );
    await settle();
    expect(claimsIn(ann.events)).toHaveLength(2);
    expect(claimsIn(bob.events)).toHaveLength(2);
    expect(ann.results).toEqual([{ ok: true }]);
  });

  it('lets one of two simultaneous claimants win', async () => {
    const { join } = await setup();
    const ann = await join('ann');
    const bob = await join('bob');

    ann.claim('d1');
    bob.claim('d1');
    await vi.waitFor(() => expect(ann.results.length + bob.results.length).toBe(2));
    const all = [...ann.results, ...bob.results];
    expect(all).toContainEqual({ ok: true });
    expect(all).toContainEqual({ ok: false, error: 'taken' });
  });

  it('loads a room once for concurrent first joiners', async () => {
    const { join, backend } = await setup();
    await Promise.all([join('ann'), join('bob'), join('cat')]);
    expect(backend.calls.filter((c) => c.startsWith('GET'))).toHaveLength(1);
  });

  it('shows a late joiner who is already seated', async () => {
    const { join } = await setup();
    const ann = await join('ann');
    const envelope = { v: 1 as const, actorId: 'ann', t: Date.now() };
    await ann.channel.send({ ...envelope, seq: 1, kind: 'presence:position', pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0, isAirborne: false } as NetEvent);
    await ann.channel.send({ ...envelope, seq: 2, kind: 'presence:seat', instanceId: 'chair-1' } as NetEvent);
    await settle();

    const late = await join('bob');
    expect(late.events).toContainEqual(expect.objectContaining({ kind: 'presence:seat', actorId: 'ann', instanceId: 'chair-1' }));
  });

  it.each([
    ['the API is down', false, true],
    ['no API is configured', true, false],
  ])('replies unavailable and starts empty when %s', async (_name, _up, apiConfigured) => {
    const { join, backend } = await setup(apiConfigured);
    backend.setDown(true);
    const ann = await join('ann');
    expect(claimsIn(ann.events)).toEqual([{}]);
    ann.claim('d1');
    await vi.waitFor(() => expect(ann.results).toEqual([{ ok: false, error: 'unavailable' }]));
    expect(claimsIn(ann.events)).toEqual([{}]);
  });
});

