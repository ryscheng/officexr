import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChannelStatus, PlayerId } from '@officexr/sdk';
import { WebSocket as RawWebSocket } from 'ws';
import { RealtimeServer } from '../server.ts';
import { decodeFrame, encodeFrame, REPLACED_CLOSE_CODE, type HelloFrame } from '../protocol.ts';
import { WsChannel, type WsChannelOptions } from '../ws-channel.ts';

const OFFICE = 'office-1';
const OFFICE_URL = 'http://web.test/api/offices/{id}';

type FakeFetch = (url: string, init?: RequestInit) => Promise<Response>;

function officeFetch(office: unknown, status = 200): FakeFetch {
  return async () => new Response(JSON.stringify(office), { status });
}

const debugOfficeOf = (login: string): FakeFetch => officeFetch({ debug_enabled: true, created_by_login: login });

describe('RealtimeServer sessions per login', () => {
  let server: RealtimeServer;
  let port: number;
  const channels: WsChannel[] = [];
  const sockets: RawWebSocket[] = [];

  async function startServer(fetchFn?: FakeFetch): Promise<void> {
    server = new RealtimeServer({ port: 0, officeUrl: OFFICE_URL, fetch: fetchFn as typeof fetch | undefined });
    await server.start();
    port = server.boundPort;
  }

  function channel(userId: PlayerId, opts: Partial<WsChannelOptions> = {}): WsChannel {
    const c = new WsChannel({ url: `ws://127.0.0.1:${port}/ws`, userId, officeId: OFFICE, reconnectDelayMs: () => 20, ...opts });
    channels.push(c);
    return c;
  }

  async function join(userId: PlayerId, login?: string): Promise<{ c: WsChannel; statuses: ChannelStatus[] }> {
    const c = channel(userId, { login });
    const statuses: ChannelStatus[] = [];
    c.onStatusChange((s) => statuses.push(s));
    await c.subscribe();
    c.trackPresence({});
    return { c, statuses };
  }

  function rawSocket(): Promise<RawWebSocket> {
    const ws = new RawWebSocket(`ws://127.0.0.1:${port}/ws`);
    sockets.push(ws);
    return new Promise((resolve, reject) => {
      ws.once('open', () => resolve(ws));
      ws.once('error', reject);
    });
  }

  function sessions(officeId: string, query: string): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}/rooms/${officeId}/sessions${query}`);
  }

  async function offices(): Promise<string[]> {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    return ((await res.json()) as { offices: string[] }).offices;
  }

  afterEach(async () => {
    for (const c of channels.splice(0)) c.close();
    for (const ws of sockets.splice(0)) ws.terminate();
    await server.stop();
  });

  async function expectSecondSessionReplacesFirst(): Promise<void> {
    const first = await join('ann#t1', 'ann');
    await join('ann#t2', 'ann');
    const observer = await join('bob');

    await vi.waitFor(() => expect(first.statuses.at(-1)).toBe('replaced'));
    await vi.waitFor(() => expect(observer.c.listPresent().sort()).toEqual(['ann#t2']));
  }

  it('replaces an older session of the same login in a non-debug office', async () => {
    await startServer(officeFetch({ debug_enabled: false, created_by_login: 'ann' }));
    await expectSecondSessionReplacesFirst();
  });

  it("keeps every session of a debug office's creator", async () => {
    await startServer(debugOfficeOf('ann'));
    const first = await join('ann#t1', 'ann');
    const second = await join('ann#t2', 'ann');
    const observer = await join('bob');

    await vi.waitFor(() => expect(observer.c.listPresent().sort()).toEqual(['ann#t1', 'ann#t2']));
    expect(first.statuses.at(-1)).toBe('live');
    expect(second.statuses.at(-1)).toBe('live');
  });

  it("still replaces a creator's reload of the same tab", async () => {
    await startServer(debugOfficeOf('ann'));
    const first = await join('ann#t1', 'ann');
    await join('ann#t1', 'ann');

    await vi.waitFor(() => expect(first.statuses.at(-1)).toBe('replaced'));
  });

  it('replaces sessions of a login that is not the creator', async () => {
    await startServer(debugOfficeOf('bob'));
    await expectSecondSessionReplacesFirst();
  });

  it('fails closed when the office lookup errors', async () => {
    await startServer(async () => {
      throw new Error('down');
    });
    await expectSecondSessionReplacesFirst();
  });

  it('fails closed on a non-200 office lookup', async () => {
    await startServer(officeFetch({ debug_enabled: true, created_by_login: 'ann' }, 404));
    await expectSecondSessionReplacesFirst();
  });

  it('fails closed on a malformed office doc', async () => {
    await startServer(officeFetch({ debug_enabled: 'true', created_by_login: 'ann' }));
    await expectSecondSessionReplacesFirst();
  });

  it('fails closed when the office lookup times out', async () => {
    await startServer(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
        }),
    );
    const first = await join('ann#t1', 'ann');
    await join('ann#t2', 'ann');

    await vi.waitFor(() => expect(first.statuses.at(-1)).toBe('replaced'));
  }, 10_000);

  it('treats a hello without login as speaking for loginOf(userId)', async () => {
    await startServer(debugOfficeOf('bob'));
    const first = await join('ann');
    await join('ann#t2');

    await vi.waitFor(() => expect(first.statuses.at(-1)).toBe('replaced'));
  });

  it('rejects a hello whose userId is not a session of its login', async () => {
    await startServer(debugOfficeOf('ann'));
    const ws = await rawSocket();
    const closed = new Promise<void>((resolve) => ws.once('close', () => resolve()));
    const hello: HelloFrame = { t: 'hello', userId: 'bob#t1', login: 'ann', officeId: OFFICE };
    ws.send(encodeFrame(hello));

    await closed;
    expect(await offices()).not.toContain(OFFICE);
  });

  it('never registers a socket that closed during the office lookup', async () => {
    let release: () => void = () => {};
    const looked = vi.fn();
    await startServer(() => {
      looked();
      return new Promise((resolve) => {
        release = () => resolve(new Response(JSON.stringify({ debug_enabled: false }), { status: 200 }));
      });
    });
    const ws = await rawSocket();
    const frames: string[] = [];
    ws.on('message', (raw) => frames.push(String(raw)));
    ws.send(encodeFrame({ t: 'hello', userId: 'ann', officeId: OFFICE }));
    await vi.waitFor(() => expect(looked).toHaveBeenCalled());

    ws.close();
    await new Promise<void>((resolve) => ws.once('close', () => resolve()));
    release();
    await new Promise((r) => setTimeout(r, 50));

    expect(frames).toEqual([]);
    expect(await offices()).not.toContain(OFFICE);
  });

  it('sends its login in hello', async () => {
    await startServer();
    const hellos: HelloFrame[] = [];
    const c = channel('ann#t1', {
      login: 'ann',
      wsFactory: (url) => {
        const ws = new WebSocket(url);
        const send = ws.send.bind(ws);
        ws.send = (data: string) => {
          const frame = decodeFrame(data);
          if (frame?.t === 'hello') {
            hellos.push(frame);
          }
          send(data);
        };
        return ws;
      },
    });
    await c.subscribe();

    expect(hellos).toEqual([{ t: 'hello', userId: 'ann#t1', login: 'ann', officeId: OFFICE }]);
  });

  describe('GET /rooms/:officeId/sessions', () => {
    it('reports whether the login is connected and may hold several sessions', async () => {
      await startServer(debugOfficeOf('ann'));
      await join('ann#t1', 'ann');

      expect(await (await sessions(OFFICE, '?login=ann')).json()).toEqual({ connected: true, allowMulti: true });
      expect(await (await sessions(OFFICE, '?login=bob')).json()).toEqual({ connected: false, allowMulti: false });
    });

    it('encodes the office id into the office URL', async () => {
      const urls: string[] = [];
      await startServer(async (url) => {
        urls.push(url);
        return new Response('{}', { status: 200 });
      });

      await sessions('a%2Fb%3F', '?login=ann');
      expect(urls).toEqual(['http://web.test/api/offices/a%2Fb%3F']);
    });

    it('rejects a missing or malformed login with 400', async () => {
      await startServer(debugOfficeOf('ann'));

      expect((await sessions(OFFICE, '')).status).toBe(400);
      expect((await sessions(OFFICE, '?login=')).status).toBe(400);
      expect((await sessions(OFFICE, '?login=ann%23t1')).status).toBe(400);
    });

    it('does not create a room', async () => {
      await startServer(debugOfficeOf('ann'));

      expect(await (await sessions('unseen', '?login=ann')).json()).toEqual({ connected: false, allowMulti: true });
      expect(await offices()).not.toContain('unseen');
    });
  });

  it('never allows several sessions without an office URL', async () => {
    const fetchFn = vi.fn(debugOfficeOf('ann'));
    server = new RealtimeServer({ port: 0, fetch: fetchFn as unknown as typeof fetch });
    await server.start();
    port = server.boundPort;

    const first = await join('ann#t1', 'ann');
    await join('ann#t2', 'ann');

    await vi.waitFor(() => expect(first.statuses.at(-1)).toBe('replaced'));
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('closes older sessions with the replaced code', async () => {
    await startServer(officeFetch({ debug_enabled: false }));
    const codes: number[] = [];
    const first = channel('ann#t1', {
      login: 'ann',
      wsFactory: (url) => {
        const ws = new WebSocket(url);
        ws.addEventListener('close', (e) => codes.push(e.code));
        return ws;
      },
    });
    await first.subscribe();
    await join('ann#t2', 'ann');

    await vi.waitFor(() => expect(codes).toEqual([REPLACED_CLOSE_CODE]));
  });
});
