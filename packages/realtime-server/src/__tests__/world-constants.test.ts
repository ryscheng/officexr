import { afterEach, describe, expect, it } from 'vitest';
import {
  createActions,
  createBus,
  createStore,
  DEFAULT_WORLD_CONSTANTS,
  SyncEngine,
  type Channel,
  type NetEvent,
  type PlayerId,
  type WorldConstants,
} from '@officexr/sdk';
import { WebSocket as RawWebSocket } from 'ws';
import { RealtimeServer, type RealtimeServerOptions } from '../server.ts';
import { WsChannel } from '../ws-channel.ts';
import { ephemeralPort, waitFor } from './helpers.ts';

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

/** Forwards to a replaceable WsChannel so one SyncEngine can span a
 * reconnect, the way a long-lived client would. */
class ReconnectingChannel implements Channel {
  private inner: WsChannel;
  private readonly handlers = new Set<(event: NetEvent) => void>();

  constructor(private readonly connect: () => WsChannel) {
    this.inner = this.wire(connect());
  }

  async reconnect(): Promise<void> {
    this.inner.close();
    this.inner = this.wire(this.connect());
    await this.inner.subscribe();
  }

  private wire(channel: WsChannel): WsChannel {
    channel.on((event) => {
      for (const h of this.handlers) h(event);
    });
    return channel;
  }

  subscribe(): Promise<void> {
    return this.inner.subscribe();
  }
  send(event: NetEvent): Promise<void> {
    return this.inner.send(event);
  }
  on(handler: (event: NetEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
  trackPresence(): void {}
  onPresenceChange(): () => void {
    return () => {};
  }
  listPresent(): PlayerId[] {
    return [];
  }
  close(): void {
    this.inner.close();
  }
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
    await waitFor(() => speedsSeen(inDefault).length === 1 && speedsSeen(inOther).length === 1);
    expect(speedsSeen(inDefault)).toEqual([DEFAULT_WORLD_CONSTANTS.animation.playerSpeed]);

    const res = await put(port, constantsWithSpeed(9));
    expect(res.status).toBe(204);
    await waitFor(() => speedsSeen(inDefault).includes(9) && speedsSeen(inOther).includes(9));

    const late = await join(port, 'C', 'third');
    await waitFor(() => late.length > 0);
    expect(speedsSeen(late)).toEqual([9]);
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

  it('returns 404 when no admin token is configured', async () => {
    const { port } = await startServer({ adminToken: undefined });
    expect((await put(port, constantsWithSpeed(9))).status).toBe(404);
  });

  it('does not relay client-sent world:constants or world:settings', async () => {
    const { server, port } = await startServer();
    const url = `ws://127.0.0.1:${port}/ws`;
    const atB = await join(port, 'B');
    const a = new RawWebSocket(url);
    await new Promise<void>((resolve) => a.once('open', () => resolve()));
    a.send(JSON.stringify({ t: 'hello', userId: 'A' }));
    const envelope = { v: 1, actorId: 'A', seq: 1, t: 0 };
    const send = (event: object) => a.send(JSON.stringify({ t: 'broadcast', from: 'A', event }));
    send({ ...envelope, kind: 'world:constants', constants: constantsWithSpeed(9) });
    send({ ...envelope, seq: 2, kind: 'world:settings', settings: { playerSpeed: 9 } });
    send({
      ...envelope,
      seq: 3,
      kind: 'presence:position',
      pos: { x: 1, y: 0, z: 0 },
      vel: { x: 0, y: 0, z: 0 },
      yaw: 0,
      isAirborne: false,
    });

    await waitFor(() => atB.some((e) => e.kind === 'presence:position'));
    expect(atB.map((e) => e.kind)).toEqual(['world:constants', 'presence:position']);
    expect(speedsSeen(atB)).toEqual([DEFAULT_WORLD_CONSTANTS.animation.playerSpeed]);
    expect(server.defaultRoom.store.getState().worldConstants).toEqual(DEFAULT_WORLD_CONSTANTS);
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
      await waitFor(() => received.length > 0);
      expect(speedsSeen(received)).toEqual([DEFAULT_WORLD_CONSTANTS.animation.playerSpeed]);

      release();
      await waitFor(() => speedsSeen(received).includes(7));
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
      await waitFor(() => calls.length === 1);
      await new Promise((r) => setTimeout(r, 50));
      expect(calls).toEqual([URL]);
      expect(server.defaultRoom.store.getState().worldConstants).toEqual(DEFAULT_WORLD_CONSTANTS);
    });

    it('retries after a network error until it gets a 200', async () => {
      let calls = 0;
      const { server } = await startServer({
        worldConstantsUrl: URL,
        fetch: async () => {
          calls += 1;
          if (calls === 1) {
            throw new TypeError('fetch failed');
          }
          return jsonResponse(200, constantsWithSpeed(5));
        },
      });
      await waitFor(
        () => server.defaultRoom.store.getState().worldConstants.animation.playerSpeed === 5,
        5000,
      );
      expect(calls).toBe(2);
    }, 10_000);
  });

  it('a SyncEngine that outlives a server restart still applies the next push', async () => {
    let { port } = await startServer();
    const store = createStore({ selfId: 'A', officeId: 'debug-office' });
    const actions = createActions(store, createBus());
    const channel = new ReconnectingChannel(
      () => new WsChannel({ url: `ws://127.0.0.1:${port}/ws`, userId: 'A' }),
    );
    const sync = new SyncEngine({ store, actions, bus: createBus(), channel, clock: { now: () => Date.now() } });
    await channel.subscribe();
    sync.start();
    const speed = () => store.getState().worldConstants.animation.playerSpeed;

    await put(port, constantsWithSpeed(9));
    await waitFor(() => speed() === 9);

    await servers.pop()!.stop();
    // A fresh port keeps the restarted server clear of fetch's pooled
    // keep-alive sockets to the old one.
    ({ port } = await startServer());
    await channel.reconnect();
    await put(port, constantsWithSpeed(4));
    await waitFor(() => speed() === 4);

    sync.stop();
    channel.close();
  });
});
