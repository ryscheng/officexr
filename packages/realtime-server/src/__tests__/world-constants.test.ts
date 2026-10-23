import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createActions,
  createBus,
  createStore,
  DEFAULT_WORLD_CONSTANTS,
  SyncEngine,
  type Channel,
  type ChannelStatus,
  type NetEvent,
  type WorldConstants,
} from '@officexr/sdk';
import { WebSocket as RawWebSocket } from 'ws';
import { RealtimeServer, type RealtimeServerOptions } from '../server.ts';
import { WsChannel } from '../ws-channel.ts';
import { ephemeralPort } from './helpers.ts';

const TOKEN = 'secret-token';

function constantsWithSpeed(playerSpeed: number): WorldConstants {
  return {
    ...DEFAULT_WORLD_CONSTANTS,
    animation: { ...DEFAULT_WORLD_CONSTANTS.animation, playerSpeed },
  };
}

function speedsSeen(events: NetEvent[]): number[] {
  return events.flatMap((e) =>
    e.kind === 'world:constants' ? [e.constants.animation.playerSpeed] : [],
  );
}

function put(port: number, body: unknown, token: string | null = TOKEN): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/admin/world-constants`, {
    method: 'PUT',
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

/** A client store kept in sync over `channel`, so inbound seq dedup applies. */
function syncedStore(channel: Channel): { speed: () => number; stop: () => void } {
  const store = createStore({ selfId: 'client', officeId: 'debug-office' });
  const bus = createBus();
  const sync = new SyncEngine({
    store,
    actions: createActions(store, bus),
    bus,
    channel,
    clock: { now: () => Date.now() },
  });
  sync.start();
  return { speed: () => store.getState().worldConstants.animation.playerSpeed, stop: () => sync.stop() };
}

describe('RealtimeServer world constants', () => {
  const servers: RealtimeServer[] = [];
  const channels: WsChannel[] = [];

  async function startServer(opts: RealtimeServerOptions = {}): Promise<{ server: RealtimeServer; port: number }> {
    const port = opts.port ?? ephemeralPort();
    const server = new RealtimeServer({ adminToken: TOKEN, ...opts, port });
    await server.start();
    servers.push(server);
    return { server, port };
  }

  async function join(port: number, userId: string, officeId?: string): Promise<NetEvent[]> {
    const channel = new WsChannel({ url: `ws://127.0.0.1:${port}/ws`, userId, officeId });
    channels.push(channel);
    const received: NetEvent[] = [];
    channel.on((e) => received.push(e));
    await channel.subscribe();
    return received;
  }

  afterEach(async () => {
    for (const c of channels.splice(0)) c.close();
    for (const s of servers.splice(0)) await s.stop();
  });

  it('pushes a PUT to clients in every room and to later joiners', async () => {
    const { port } = await startServer();
    const inDefault = await join(port, 'A');
    const inOther = await join(port, 'B', 'other');
    await vi.waitFor(() => {
      expect(speedsSeen(inDefault)).toHaveLength(1);
      expect(speedsSeen(inOther)).toHaveLength(1);
    });
    expect(speedsSeen(inDefault)).toEqual([DEFAULT_WORLD_CONSTANTS.animation.playerSpeed]);

    const res = await put(port, constantsWithSpeed(9));
    expect(res.status).toBe(204);
    await vi.waitFor(() => {
      expect(speedsSeen(inDefault)).toContain(9);
      expect(speedsSeen(inOther)).toContain(9);
    });

    const late = await join(port, 'C', 'third');
    await vi.waitFor(() => expect(speedsSeen(late)).toEqual([9]));
  });

  it('rejects a bad token (401) and an invalid body (400) without pushing', async () => {
    const { server, port } = await startServer();
    const received = await join(port, 'A');

    expect((await put(port, constantsWithSpeed(9), 'wrong')).status).toBe(401);
    expect((await put(port, constantsWithSpeed(9), null)).status).toBe(401);
    const invalid = await put(port, constantsWithSpeed(-1));
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).toContain('playerSpeed');

    await new Promise((r) => setTimeout(r, 100));
    expect(speedsSeen(received)).toEqual([DEFAULT_WORLD_CONSTANTS.animation.playerSpeed]);
    expect(server.defaultRoom.store.getState().worldConstants).toEqual(DEFAULT_WORLD_CONSTANTS);
  });

  it('rejects an oversized body with 413', async () => {
    const { port } = await startServer();
    expect((await put(port, 'x'.repeat(1024 * 1024 + 1))).status).toBe(413);
  });

  it('returns 404 when no admin token, or an empty one, is configured', async () => {
    for (const adminToken of [undefined, '']) {
      const { port } = await startServer({ adminToken });
      expect((await put(port, constantsWithSpeed(9), '')).status).toBe(404);
    }
  });

  it("closes a connection whose hello claims the server's id", async () => {
    const { port } = await startServer();
    const ws = new RawWebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve) => ws.once('open', () => resolve()));
    const closed = new Promise<void>((resolve) => ws.once('close', () => resolve()));
    ws.send(JSON.stringify({ t: 'hello', userId: 'server' }));
    await closed;
  });

  it('does not relay client-sent world events or a spoofed server actor', async () => {
    const { server, port } = await startServer();
    const url = `ws://127.0.0.1:${port}/ws`;
    const bChannel = new WsChannel({ url, userId: 'B' });
    channels.push(bChannel);
    const atB: NetEvent[] = [];
    bChannel.on((e) => atB.push(e));
    const b = syncedStore(bChannel);
    await bChannel.subscribe();
    const a = new RawWebSocket(url);
    await new Promise<void>((resolve) => a.once('open', () => resolve()));
    a.send(JSON.stringify({ t: 'hello', userId: 'A' }));
    const envelope = { v: 1, actorId: 'A', seq: 1, t: 0 };
    const send = (event: object) => a.send(JSON.stringify({ t: 'broadcast', from: 'A', event }));
    send({ ...envelope, kind: 'world:constants', constants: constantsWithSpeed(9) });
    send({ ...envelope, seq: 2, kind: 'world:settings', settings: { playerSpeed: 9 } });
    const position = {
      kind: 'presence:position',
      pos: { x: 1, y: 0, z: 0 },
      vel: { x: 0, y: 0, z: 0 },
      yaw: 0,
      isAirborne: false,
    };
    send({ ...envelope, ...position, actorId: 'server', seq: Number.MAX_SAFE_INTEGER });
    send({ ...envelope, ...position, seq: 3 });

    await vi.waitFor(() => expect(atB.map((e) => e.kind)).toContain('presence:position'));
    expect(atB.map((e) => [e.kind, e.actorId])).toEqual([
      ['world:constants', 'server'],
      ['presence:position', 'A'],
    ]);
    expect(server.defaultRoom.store.getState().worldConstants).toEqual(DEFAULT_WORLD_CONSTANTS);

    await put(port, constantsWithSpeed(6));
    await vi.waitFor(() => expect(b.speed()).toBe(6));
    b.stop();
    a.close();
  });

  describe('boot load', () => {
    const URL = 'http://source.test/world-settings';

    it('adopts a 200 doc and pushes it to connected clients', async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const { server, port } = await startServer({
        worldConstantsUrl: URL,
        fetch: async () => {
          await gate;
          return jsonResponse(200, constantsWithSpeed(7));
        },
      });
      const received = await join(port, 'A');
      await vi.waitFor(() =>
        expect(speedsSeen(received)).toEqual([DEFAULT_WORLD_CONSTANTS.animation.playerSpeed]),
      );

      release();
      await vi.waitFor(() => expect(speedsSeen(received)).toContain(7));
      expect(server.defaultRoom.store.getState().worldConstants.animation.playerSpeed).toBe(7);
    });

    it('keeps the defaults on a 404', async () => {
      const calls: string[] = [];
      const { server } = await startServer({
        worldConstantsUrl: URL,
        fetch: async (input) => {
          calls.push(String(input));
          return jsonResponse(404);
        },
      });
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      await new Promise((r) => setTimeout(r, 50));
      expect(calls).toEqual([URL]);
      expect(server.defaultRoom.store.getState().worldConstants).toEqual(DEFAULT_WORLD_CONSTANTS);
    });

    it('retries after a network error until it gets a 200', async () => {
      let calls = 0;
      const { server } = await startServer({
        worldConstantsUrl: URL,
        bootRetryMs: 10,
        fetch: async () => {
          calls += 1;
          if (calls === 1) {
            throw new TypeError('fetch failed');
          }
          return jsonResponse(200, constantsWithSpeed(5));
        },
      });
      await vi.waitFor(() =>
        expect(server.defaultRoom.store.getState().worldConstants.animation.playerSpeed).toBe(5),
      );
      expect(calls).toBe(2);
    });

    it('lets a PUT win over a boot load still in flight', async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const { server, port } = await startServer({
        worldConstantsUrl: URL,
        fetch: async () => {
          await gate;
          return jsonResponse(200, constantsWithSpeed(7));
        },
      });
      expect((await put(port, constantsWithSpeed(9))).status).toBe(204);
      release();
      await new Promise((r) => setTimeout(r, 50));
      expect(server.defaultRoom.store.getState().worldConstants.animation.playerSpeed).toBe(9);
    });
  });

  it('a SyncEngine that outlives a server restart still applies the next push', async () => {
    const { port } = await startServer();
    const channel = new WsChannel({ url: `ws://127.0.0.1:${port}/ws`, userId: 'A', reconnectDelayMs: () => 20 });
    channels.push(channel);
    const statuses: ChannelStatus[] = [];
    channel.onStatusChange((s) => statuses.push(s));
    const client = syncedStore(channel);
    await channel.subscribe();

    await put(port, constantsWithSpeed(9));
    await vi.waitFor(() => expect(client.speed()).toBe(9));

    await servers.pop()!.stop();
    await startServer({ port });
    await vi.waitFor(() => expect(statuses).toEqual(['connecting', 'live', 'reconnecting', 'live']));
    await put(port, constantsWithSpeed(4));
    await vi.waitFor(() => expect(client.speed()).toBe(4));

    client.stop();
  });
});
