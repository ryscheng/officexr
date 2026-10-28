import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket as RawWebSocket } from 'ws';
import { RealtimeServer } from '../server.ts';
import { signJoinToken } from '../join-token.ts';
import { decodeFrame, encodeFrame, type Frame } from '../protocol.ts';
import { WsChannel } from '../ws-channel.ts';

const SECRET = 'join-secret';
const OFFICE = 'office-1';
const T0 = 1_000_000;

describe('RealtimeServer join tokens', () => {
  let server: RealtimeServer;
  let port = 0;
  let clock = T0;
  const sockets: RawWebSocket[] = [];
  const channels: WsChannel[] = [];

  async function start(tokenSecret: string | null = SECRET): Promise<void> {
    server = new RealtimeServer({ port, tokenSecret: tokenSecret ?? undefined, now: () => clock });
    await server.start();
    port = server.boundPort;
  }

  const tokenFor = (login: string, ttlMs = 60_000, secret = SECRET): string =>
    signJoinToken(secret, { login, ttlMs, now: T0 });

  /** Sends one hello and reports whether the server acked it or closed the socket. */
  async function tryJoin(hello: { userId: string; login?: string; token?: string }): Promise<'joined' | 'rejected'> {
    const ws = new RawWebSocket(`ws://127.0.0.1:${port}/ws`);
    sockets.push(ws);
    return new Promise((resolve) => {
      ws.on('message', (raw) => {
        const frame: Frame | null = decodeFrame(String(raw));
        if (frame?.t === 'hello-ack') {
          resolve('joined');
        }
      });
      ws.on('close', () => resolve('rejected'));
      ws.on('open', () => ws.send(encodeFrame({ t: 'hello', officeId: OFFICE, ...hello })));
    });
  }

  const sessions = (query: string): Promise<Response> =>
    fetch(`http://127.0.0.1:${port}/rooms/${OFFICE}/sessions${query}`);

  afterEach(async () => {
    clock = T0;
    port = 0;
    for (const c of channels.splice(0)) c.close();
    for (const ws of sockets.splice(0)) ws.terminate();
    await server.stop();
  });

  it('admits a valid token, for the bare login and for its session ids', async () => {
    await start();
    expect(await tryJoin({ userId: 'ann', token: tokenFor('ann') })).toBe('joined');
    expect(await tryJoin({ userId: 'ann#t1', token: tokenFor('ann') })).toBe('joined');
    expect(await tryJoin({ userId: 'ann#t2', login: 'ann', token: tokenFor('ann') })).toBe('joined');
  });

  it('rejects a missing, forged, wrong-secret or expired token', async () => {
    await start();
    expect(await tryJoin({ userId: 'ann' })).toBe('rejected');
    expect(await tryJoin({ userId: 'ann', token: 'garbage' })).toBe('rejected');
    expect(await tryJoin({ userId: 'ann', token: tokenFor('ann', 60_000, 'other') })).toBe('rejected');
    clock = T0 + 60_000;
    expect(await tryJoin({ userId: 'ann', token: tokenFor('ann') })).toBe('rejected');
  });

  it("rejects a token for another login's player id", async () => {
    await start();
    expect(await tryJoin({ userId: 'bob', token: tokenFor('ann') })).toBe('rejected');
    expect(await tryJoin({ userId: 'bob#t1', token: tokenFor('ann') })).toBe('rejected');
    expect(await tryJoin({ userId: 'ann', login: 'bob', token: tokenFor('ann') })).toBe('rejected');
  });

  it('works unchanged when no secret is set', async () => {
    await start(null);
    expect(await tryJoin({ userId: 'ann' })).toBe('joined');
    expect(await tryJoin({ userId: 'bob', token: 'ignored' })).toBe('joined');
  });

  it('treats an empty secret as unset', async () => {
    await start('');
    expect(await tryJoin({ userId: 'ann' })).toBe('joined');
  });

  it('refreshes the token through getToken on reconnect', async () => {
    await start();
    let calls = 0;
    const c = new WsChannel({
      url: `ws://127.0.0.1:${port}/ws`,
      userId: 'ann',
      officeId: OFFICE,
      reconnectDelayMs: () => 20,
      getToken: async () => {
        calls++;
        return tokenFor('ann');
      },
    });
    channels.push(c);
    await c.subscribe();
    expect(calls).toBe(1);

    await server.stop();
    await start();
    await vi.waitFor(() => expect(calls).toBeGreaterThan(1));
  });

  describe('GET /rooms/:id/sessions', () => {
    it('requires a token matching the login', async () => {
      await start();
      expect((await sessions('?login=ann')).status).toBe(401);
      expect((await sessions(`?login=ann&token=${tokenFor('bob')}`)).status).toBe(401);
      expect((await sessions('?login=ann&token=garbage')).status).toBe(401);
      const ok = await sessions(`?login=ann&token=${encodeURIComponent(tokenFor('ann'))}`);
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ connected: false, allowMulti: false });
    });

    it('needs no token when no secret is set', async () => {
      await start(null);
      expect((await sessions('?login=ann')).status).toBe(200);
    });
  });
});
