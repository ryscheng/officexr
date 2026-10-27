import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyNetEventToStore,
  createActions,
  createBus,
  createStore,
  type NetEvent,
} from '@officexr/sdk';
import { WebSocket as RawWebSocket, WebSocketServer } from 'ws';
import { RealtimeServer } from '../server.ts';
import { REPLACED_CLOSE_CODE } from '../protocol.ts';
import { WsChannel } from '../ws-channel.ts';
// Note: external consumers go via subpath exports:
//   import { WsChannel } from '@officexr/realtime-server';
//   import { RealtimeServer } from '@officexr/realtime-server/server';
// The internal test imports go through relative paths so they don't
// depend on the exports map being resolved.

function makeMoveEvent(actor: string, x: number): NetEvent {
  return {
    kind: 'presence:position',
    v: 1,
    actorId: actor,
    seq: 1,
    t: 0,
    pos: { x, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    isAirborne: false,
  };
}

describe('RealtimeServer + WsChannel roundtrip', () => {
  let port: number;
  let server: RealtimeServer;

  beforeEach(async () => {
    server = new RealtimeServer({ port: 0, officeId: 'test-office' });
    await server.start();
    port = server.boundPort;
  });

  afterEach(async () => {
    await server.stop();
  });

  it('A.send(event) is delivered to B over the wire', async () => {
    const url = `ws://127.0.0.1:${port}/ws`;
    const a = new WsChannel({ url, userId: 'A' });
    const b = new WsChannel({ url, userId: 'B' });

    await a.subscribe();
    await b.subscribe();

    const received: NetEvent[] = [];
    b.on((event) => received.push(event));

    await a.send(makeMoveEvent('A', 1.5));
    await vi.waitFor(() => expect(received.length > 0).toBe(true));

    expect(received[0].kind).toBe('presence:position');
    expect(received[0].actorId).toBe('A');
    if (received[0].kind === 'presence:position') {
      expect(received[0].pos.x).toBeCloseTo(1.5);
    }

    a.close();
    b.close();
  });

  it('presence change frames fire onPresenceChange for the other peer', async () => {
    const url = `ws://127.0.0.1:${port}/ws`;
    const a = new WsChannel({ url, userId: 'A' });
    const b = new WsChannel({ url, userId: 'B' });
    const aPresence: { joined: string[]; left: string[] }[] = [];
    a.onPresenceChange((joined, left) => {
      aPresence.push({ joined: [...joined], left: [...left] });
    });

    await a.subscribe();
    a.trackPresence({});
    await b.subscribe();
    b.trackPresence({});

    // A should see B join.
    await vi.waitFor(() => expect(aPresence.some((p) => p.joined.includes('B'))).toBe(true));
    expect(a.listPresent()).toContain('B');

    // B disconnects — A sees a leave.
    b.close();
    await vi.waitFor(() => expect(aPresence.some((p) => p.left.includes('B'))).toBe(true));
    expect(a.listPresent()).not.toContain('B');

    a.close();
  });

  it('late joiner receives a snapshot of existing peer positions', async () => {
    const url = `ws://127.0.0.1:${port}/ws`;
    const a = new WsChannel({ url, userId: 'A' });
    await a.subscribe();
    await a.send(makeMoveEvent('A', 7));
    // Give the server's mirror a moment to apply the event.
    await vi.waitFor(() => expect(server.defaultRoom.store.getState().players['A']?.pos.x).toBe(7));

    const b = new WsChannel({ url, userId: 'B' });
    const received: NetEvent[] = [];
    b.on((ev) => received.push(ev));
    await b.subscribe();

    await vi.waitFor(() => expect(received.some((e) => e.actorId === 'A')).toBe(true));
    const snap = received.find((e) => e.actorId === 'A');
    expect(snap?.kind).toBe('presence:position');
    if (snap?.kind === 'presence:position') {
      expect(snap.pos.x).toBeCloseTo(7);
    }

    a.close();
    b.close();
  });

  it('late joiner snapshot carries earlier avatar:update with the name', async () => {
    const url = `ws://127.0.0.1:${port}/ws`;
    const a = new WsChannel({ url, userId: 'A' });
    await a.subscribe();
    await a.send(makeMoveEvent('A', 1));
    await a.send({
      kind: 'avatar:update',
      v: 1,
      actorId: 'A',
      seq: 2,
      t: 0,
      avatar: { model: 'gnome' },
      name: 'Alice',
    });
    await vi.waitFor(() => expect(server.defaultRoom.store.getState().players['A']?.name).toBe('Alice'));

    const b = new WsChannel({ url, userId: 'B' });
    const received: NetEvent[] = [];
    b.on((ev) => received.push(ev));
    await b.subscribe();
    await vi.waitFor(() => expect(received.some((e) => e.kind === 'avatar:update')).toBe(true));

    const store = createStore({ selfId: 'B', officeId: 'test-office' });
    const actions = createActions(store, createBus());
    for (const ev of received) {
      applyNetEventToStore(actions, ev, { now: () => Date.now() });
    }
    expect(store.getState().players['A']?.name).toBe('Alice');
    expect(store.getState().players['A']?.avatar.model).toBe('gnome');

    a.close();
    b.close();
  });

  it('keeps offices isolated and keeps both connections of one user live', async () => {
    const url = `ws://127.0.0.1:${port}/ws`;
    const a1 = new WsChannel({ url, userId: 'A', officeId: 'office-1' });
    const b1 = new WsChannel({ url, userId: 'B', officeId: 'office-1' });
    const a2 = new WsChannel({ url, userId: 'A', officeId: 'office-2' });
    const c2 = new WsChannel({ url, userId: 'C', officeId: 'office-2' });
    await Promise.all([a1.subscribe(), b1.subscribe(), a2.subscribe(), c2.subscribe()]);

    const atB: NetEvent[] = [];
    const atC: NetEvent[] = [];
    const presenceC: string[] = [];
    b1.on((e) => atB.push(e));
    c2.on((e) => atC.push(e));
    c2.onPresenceChange((joined, left) => presenceC.push(...joined, ...left));

    b1.trackPresence({});
    await vi.waitFor(() => expect(a1.listPresent().includes('B')).toBe(true));

    await a1.send(makeMoveEvent('A', 3));
    await a2.send(makeMoveEvent('A', 4));
    await vi.waitFor(() => expect(atB.length > 0 && atC.length > 0).toBe(true));

    const xs = (events: NetEvent[]) =>
      events.map((e) => (e.kind === 'presence:position' ? e.pos.x : null));
    expect(xs(atB)).toEqual([3]);
    expect(xs(atC)).toEqual([4]);
    expect(presenceC).not.toContain('B');

    a1.close();
    a2.close();
    b1.close();
    c2.close();
  });

  it('a replaced socket closing late does not evict its successor or the room', async () => {
    const url = `ws://127.0.0.1:${port}/ws`;
    const old = new RawWebSocket(url);
    await new Promise<void>((resolve) => old.once('open', () => resolve()));
    old.send(JSON.stringify({ t: 'hello', userId: 'A', officeId: 'office-x' }));
    const oldClosed = new Promise<void>((resolve) => old.once('close', () => resolve()));

    const a = new WsChannel({ url, userId: 'A', officeId: 'office-x' });
    await a.subscribe();
    await oldClosed;

    const offices = async (): Promise<string[]> =>
      ((await (await fetch(`http://127.0.0.1:${port}/health`)).json()) as {
        offices: string[];
      }).offices;
    // Let the server-side close of the old socket land.
    await new Promise((r) => setTimeout(r, 100));
    expect(await offices()).toContain('office-x');

    const b = new WsChannel({ url, userId: 'B', officeId: 'office-x' });
    await b.subscribe();
    const received: NetEvent[] = [];
    b.on((e) => received.push(e));
    await a.send(makeMoveEvent('A', 5));
    await vi.waitFor(() => expect(received.length > 0).toBe(true));

    a.close();
    b.close();
  });

  it('scopes custom frames to the sender room', async () => {
    const url = `ws://127.0.0.1:${port}/ws`;
    server.onCustomFrame((_client, _kind, payload, room) => {
      room.sendCustom('echo', payload);
      return true;
    });

    const inDefault = new WsChannel({ url, userId: 'D' });
    const inOther = new WsChannel({ url, userId: 'O', officeId: 'other' });
    await inDefault.subscribe();
    await inOther.subscribe();
    const atDefault: unknown[] = [];
    const atOther: unknown[] = [];
    inDefault.onCustom('echo', (p) => atDefault.push(p));
    inOther.onCustom('echo', (p) => atOther.push(p));

    inOther.sendCustom('ping', 'other');
    await vi.waitFor(() => expect(atOther.length > 0).toBe(true));
    inDefault.sendCustom('ping', 'default');
    await vi.waitFor(() => expect(atDefault.length > 0).toBe(true));

    expect(atOther).toEqual(['other']);
    expect(atDefault).toEqual(['default']);

    inDefault.close();
    inOther.close();
  });

  it('custom frames round-trip through onCustomFrame', async () => {
    const url = `ws://127.0.0.1:${port}/ws`;
    const seen: { kind: string; payload: unknown }[] = [];
    server.onCustomFrame((_client, kind, payload) => {
      seen.push({ kind, payload });
      return true;
    });

    const a = new WsChannel({ url, userId: 'A' });
    await a.subscribe();
    a.sendCustom('bots:set-count', { n: 3 });

    await vi.waitFor(() => expect(seen.length > 0).toBe(true));
    expect(seen[0]).toEqual({ kind: 'bots:set-count', payload: { n: 3 } });

    a.close();
  });
});

describe('WsChannel handshake', () => {
  it('rejects subscribe() as soon as the socket closes before hello-ack', async () => {
    const wss = new WebSocketServer({ port: 0 });
    wss.on('connection', (ws) => ws.on('message', () => ws.close()));
    await new Promise<void>((resolve) => wss.once('listening', () => resolve()));
    const { port } = wss.address() as AddressInfo;
    try {
      const channel = new WsChannel({ url: `ws://127.0.0.1:${port}/ws`, userId: 'A', handshakeTimeoutMs: 10_000 });
      const started = Date.now();
      await expect(channel.subscribe()).rejects.toThrow('closed before handshake');
      expect(Date.now() - started).toBeLessThan(2000);
    } finally {
      await new Promise((resolve) => wss.close(resolve));
    }
  });

  it('has status replaced by the time subscribe() rejects after a replaced close before hello-ack', async () => {
    const wss = new WebSocketServer({ port: 0 });
    wss.on('connection', (ws) => ws.on('message', () => ws.close(REPLACED_CLOSE_CODE, 'replaced')));
    await new Promise<void>((resolve) => wss.once('listening', () => resolve()));
    const { port } = wss.address() as AddressInfo;
    try {
      const channel = new WsChannel({ url: `ws://127.0.0.1:${port}/ws`, userId: 'A' });
      let statusInCatch: string | undefined;
      await expect(
        channel.subscribe().catch((err) => {
          channel.onStatusChange((s) => (statusInCatch = s))();
          throw err;
        }),
      ).rejects.toThrow();
      expect(statusInCatch).toBe('replaced');
    } finally {
      await new Promise((resolve) => wss.close(resolve));
    }
  });
});
