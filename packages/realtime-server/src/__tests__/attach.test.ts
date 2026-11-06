import { createServer, request, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket as RawWebSocket, WebSocketServer } from 'ws';
import { decodeFrame, encodeFrame, type Frame } from '../protocol.ts';
import { officeAllowsMultiSession } from '../office-policy.ts';
import { RealtimeServer, type RealtimeServerOptions } from '../server.ts';

const TOKEN = 'admin-token';

describe('RealtimeServer attached to a host server', () => {
  const servers: RealtimeServer[] = [];
  const hosts: HttpServer[] = [];
  const sockets: RawWebSocket[] = [];

  async function host(
    opts: RealtimeServerOptions = {},
    extra: (host: HttpServer) => void = () => {},
  ): Promise<{ server: RealtimeServer; host: HttpServer; port: number }> {
    const server = new RealtimeServer(opts);
    const http = createServer((req, res) => {
      server.requestHandler(req, res, () => {
        server.adminHandler(req, res, () => {
          res.writeHead(404).end();
        });
      });
    });
    server.attach(http);
    extra(http);
    await new Promise<void>((resolve) => http.listen(0, resolve));
    servers.push(server);
    hosts.push(http);
    return { server, host: http, port: (http.address() as AddressInfo).port };
  }

  function connect(port: number, path = '/ws'): Promise<RawWebSocket> {
    const ws = new RawWebSocket(`ws://127.0.0.1:${port}${path}`);
    sockets.push(ws);
    return new Promise((resolve, reject) => {
      ws.once('open', () => resolve(ws));
      ws.once('error', reject);
    });
  }

  async function join(port: number, userId: string): Promise<Frame[]> {
    const ws = await connect(port);
    const frames: Frame[] = [];
    ws.on('message', (raw) => {
      const frame = decodeFrame(String(raw));
      if (frame) {
        frames.push(frame);
      }
    });
    ws.send(encodeFrame({ t: 'hello', userId, officeId: 'o1' }));
    await expect.poll(() => frames.some((f) => f.t === 'hello-ack')).toBe(true);
    ws.send(encodeFrame({ t: 'track-presence', data: {} }));
    return frames;
  }

  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.terminate();
    for (const s of servers.splice(0)) await s.stop();
    await Promise.all(
      hosts.splice(0).map((h) => {
        h.closeAllConnections();
        return new Promise((resolve) => h.close(resolve));
      }),
    );
  });

  it('accepts a /ws client that completes hello', async () => {
    const { port } = await host();
    const frames = await join(port, 'ann');

    await expect.poll(() => frames.map((f) => f.t)).toEqual(['hello-ack', 'snapshot']);
  });

  it('leaves upgrades on other paths to the host', async () => {
    const other = new WebSocketServer({ noServer: true });
    const { port } = await host({}, (http) => {
      http.on('upgrade', (req, socket, head) => {
        if (req.url === '/hmr') {
          other.handleUpgrade(req, socket, head, () => {});
        }
      });
    });

    const ws = await connect(port, '/hmr');
    expect(ws.readyState).toBe(RawWebSocket.OPEN);
    other.close();
  });

  it.each(['/hmr', '/ws'])('survives an upgrade with a malformed Host on %s', async (path) => {
    const upgraded: Duplex[] = [];
    const { host: http, port } = await host({}, (h) => {
      h.on('upgrade', (_req, socket) => upgraded.push(socket));
    });
    const uncaught = vi.fn();
    process.on('uncaughtException', uncaught);
    const req = request({
      port,
      path,
      headers: { connection: 'Upgrade', upgrade: 'websocket', host: 'a b' },
    });
    req.on('error', () => {});
    req.end();
    await new Promise((r) => setTimeout(r, 100));
    req.destroy();
    upgraded.forEach((s) => s.destroy());
    process.off('uncaughtException', uncaught);

    expect(uncaught).not.toHaveBeenCalled();
    expect(http.listening).toBe(true);
  });

  it('serves /health and /rooms/:id/sessions and falls through otherwise', async () => {
    const { port } = await host({ sessionPolicy: async () => true });

    const health = await fetch(`http://127.0.0.1:${port}/health`);
    expect(await health.json()).toEqual({ ok: true, offices: ['debug-office'] });
    const sessions = await fetch(`http://127.0.0.1:${port}/rooms/o1/sessions?login=ann`);
    expect(await sessions.json()).toEqual({ connected: false, allowMulti: true });
    expect((await fetch(`http://127.0.0.1:${port}/nope`)).status).toBe(404);
  });

  it('requestHandler calls next() for paths it does not own', () => {
    const server = new RealtimeServer();
    const next = vi.fn();
    const res = {} as ServerResponse;
    server.requestHandler({ url: '/nope', method: 'GET' } as IncomingMessage, res, next);
    server.requestHandler({ url: '/admin/world-constants', method: 'PUT' } as IncomingMessage, res, next);
    server.requestHandler({ url: '/health', method: 'POST' } as IncomingMessage, res, next);
    expect(next).toHaveBeenCalledTimes(3);
  });

  it('adminHandler enforces the token, and falls through without one', async () => {
    const put = (port: number, auth?: string) =>
      fetch(`http://127.0.0.1:${port}/admin/world-constants`, {
        method: 'PUT',
        headers: auth ? { authorization: auth } : {},
        body: '{}',
      });
    const withToken = await host({ adminToken: TOKEN });
    expect((await put(withToken.port)).status).toBe(401);
    expect((await put(withToken.port, 'Bearer wrong')).status).toBe(401);
    expect((await put(withToken.port, `Bearer ${TOKEN}`)).status).toBe(400);

    const withoutToken = await host();
    expect((await put(withoutToken.port, `Bearer ${TOKEN}`)).status).toBe(404);
  });

  it('keeps every session when the injected policy allows it', async () => {
    const { port } = await host({ sessionPolicy: async () => true });
    const first = await join(port, 'ann#t1');
    await expect.poll(() => first.length).toBe(2);
    await join(port, 'ann#t2');

    await expect
      .poll(() => first.filter((f) => f.t === 'presence' && f.joined.includes('ann#t2')).length)
      .toBe(1);
    expect(sockets[0].readyState).toBe(RawWebSocket.OPEN);
  });

  it('replaces older sessions when the policy rejects', async () => {
    const { port } = await host({ sessionPolicy: () => Promise.reject(new Error('down')) });
    const first = await join(port, 'ann#t1');
    await expect.poll(() => first.length).toBe(2);
    await join(port, 'ann#t2');

    await expect.poll(() => sockets[0].readyState).toBe(RawWebSocket.CLOSED);
  });

  it('stop() closes clients and the upgrade path but leaves the host listening', async () => {
    const { server, host: http, port } = await host();
    await join(port, 'ann');
    await expect.poll(() => sockets[0].readyState).toBe(RawWebSocket.OPEN);

    await server.stop();

    await expect.poll(() => sockets[0].readyState).toBe(RawWebSocket.CLOSED);
    expect(http.listening).toBe(true);
    expect(http.listenerCount('upgrade')).toBe(0);
    expect((await fetch(`http://127.0.0.1:${port}/nope`)).status).toBe(404);
  });

  it('refuses attach() after start(), start() after attach(), and boundPort when attached', async () => {
    const started = new RealtimeServer({ port: 0 });
    await started.start();
    servers.push(started);
    expect(() => started.attach(createServer())).toThrow(/neither started nor attached/);

    const { server } = await host();
    await expect(server.start()).rejects.toThrow(/cannot follow attach/);
    expect(() => server.boundPort).toThrow(/attached/);
  });
});

describe('officeAllowsMultiSession', () => {
  it.each([
    [{ debug_enabled: true, created_by_login: 'ann' }, 'ann', true],
    [{ debug_enabled: true, created_by_login: 'bob' }, 'ann', false],
    [{ debug_enabled: false, created_by_login: 'ann' }, 'ann', false],
    [{ debug_enabled: 'true', created_by_login: 'ann' }, 'ann', false],
    [{ created_by_login: 'ann' }, 'ann', false],
    [{}, 'ann', false],
  ])('%j for %s is %s', (office, login, expected) => {
    expect(officeAllowsMultiSession(office, login)).toBe(expected);
  });
});
