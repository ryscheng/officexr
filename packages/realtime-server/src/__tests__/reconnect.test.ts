import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createActions,
  createBus,
  createStore,
  SyncEngine,
  type ChannelStatus,
  type NetEvent,
  type PlayerId,
  type Store,
} from '@officexr/sdk';
import { RealtimeServer } from '../server.ts';
import { REPLACED_CLOSE_CODE } from '../protocol.ts';
import { WsChannel, type WsChannelOptions } from '../ws-channel.ts';
import { ephemeralPort } from './helpers.ts';

function moveEvent(actor: string, seq: number): NetEvent {
  return {
    kind: 'presence:position',
    v: 1,
    actorId: actor,
    seq,
    t: 0,
    pos: { x: 1, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    isAirborne: false,
  };
}

function nameOf(store: Store, id: PlayerId): string | undefined {
  return store.getState().players[id]?.name;
}

describe('WsChannel reconnect', () => {
  let port: number;
  let server: RealtimeServer;
  const channels: WsChannel[] = [];
  const stops: (() => void)[] = [];

  async function startServer(): Promise<void> {
    server = new RealtimeServer({ port });
    await server.start();
  }

  async function restartServer(): Promise<void> {
    await server.stop();
    await startServer();
  }

  function channel(userId: PlayerId, opts: Partial<WsChannelOptions> = {}): WsChannel {
    const c = new WsChannel({ url: `ws://127.0.0.1:${port}/ws`, userId, reconnectDelayMs: () => 20, ...opts });
    channels.push(c);
    return c;
  }

  function statusesOf(c: WsChannel): ChannelStatus[] {
    const statuses: ChannelStatus[] = [];
    c.onStatusChange((s) => statuses.push(s));
    return statuses;
  }

  /** A SyncEngine-driven peer that names itself once connected, as the web app does. */
  async function namedPeer(userId: PlayerId): Promise<{ store: Store; statuses: ChannelStatus[] }> {
    const c = channel(userId);
    const statuses = statusesOf(c);
    const store = createStore({ selfId: userId, officeId: 'debug-office' });
    const bus = createBus();
    const actions = createActions(store, bus);
    actions.upsertPlayer({ id: userId, pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0 });
    const sync = new SyncEngine({ store, actions, bus, channel: c, clock: { now: () => Date.now() } });
    // Started first so the join snapshot, which can arrive in the same tick as hello-ack, isn't missed.
    sync.start();
    stops.push(() => sync.stop());
    await c.subscribe();
    c.trackPresence({});
    actions.upsertPlayer({ id: userId, name: `name-${userId}` });
    return { store, statuses };
  }

  afterEach(async () => {
    for (const stop of stops.splice(0)) stop();
    for (const c of channels.splice(0)) c.close();
    await server.stop();
  });

  it('reconnects after a server restart and receives peer broadcasts again', async () => {
    port = ephemeralPort();
    await startServer();
    const a = channel('A');
    const b = channel('B');
    const aStatuses = statusesOf(a);
    const bStatuses = statusesOf(b);
    const received: NetEvent[] = [];
    a.on((e) => received.push(e));
    await a.subscribe();
    await b.subscribe();

    await restartServer();
    await vi.waitFor(() => {
      expect(aStatuses).toEqual(['connecting', 'live', 'reconnecting', 'live']);
      expect(bStatuses).toEqual(['connecting', 'live', 'reconnecting', 'live']);
    });

    await b.send(moveEvent('B', 1));
    await vi.waitFor(() => expect(received.some((e) => e.actorId === 'B')).toBe(true));
  });

  it('reports a peer that left during the gap as left after reconnecting', async () => {
    port = ephemeralPort();
    await startServer();
    const a = channel('A');
    const b = channel('B');
    const leftAfterReconnect: PlayerId[] = [];
    let reconnected = false;
    a.onStatusChange((s) => {
      if (s === 'reconnecting') {
        reconnected = true;
      }
    });
    a.onPresenceChange((_joined, left) => {
      if (reconnected) {
        leftAfterReconnect.push(...left);
      }
    });
    await a.subscribe();
    a.trackPresence({});
    await b.subscribe();
    b.trackPresence({});
    await vi.waitFor(() => expect(a.listPresent()).toContain('B'));

    await server.stop();
    b.close();
    await startServer();

    await vi.waitFor(() => expect(leftAfterReconnect).toContain('B'));
    expect(a.listPresent()).not.toContain('B');
  });

  it('SyncEngine peers re-announce their names to a restarted server', async () => {
    port = ephemeralPort();
    await startServer();
    const a = await namedPeer('A');
    const b = await namedPeer('B');
    await vi.waitFor(() => {
      expect(nameOf(a.store, 'B')).toBe('name-B');
      expect(nameOf(b.store, 'A')).toBe('name-A');
    });

    await restartServer();
    await vi.waitFor(() => {
      expect(a.statuses.at(-1)).toBe('live');
      expect(b.statuses.at(-1)).toBe('live');
      expect(nameOf(a.store, 'B')).toBe('name-B');
      expect(nameOf(b.store, 'A')).toBe('name-A');
    });

    // The restarted server only knows these names from the re-announce.
    const c = await namedPeer('C');
    await vi.waitFor(() => {
      expect(nameOf(c.store, 'A')).toBe('name-A');
      expect(nameOf(c.store, 'B')).toBe('name-B');
    });
  });

  it('stops for good when a newer socket with the same userId replaces it', async () => {
    port = ephemeralPort();
    await startServer();
    const closeCodes: number[] = [];
    let sockets = 0;
    const first = channel('A', {
      wsFactory: (url) => {
        sockets++;
        const ws = new WebSocket(url);
        ws.addEventListener('close', (e) => closeCodes.push(e.code));
        return ws;
      },
    });
    const statuses = statusesOf(first);
    await first.subscribe();

    await channel('A').subscribe();

    await vi.waitFor(() => expect(statuses.at(-1)).toBe('replaced'));
    expect(closeCodes).toEqual([REPLACED_CLOSE_CODE]);
    await new Promise((r) => setTimeout(r, 100));
    expect(sockets).toBe(1);
    expect(statuses).toEqual(['connecting', 'live', 'replaced']);
  });
});
