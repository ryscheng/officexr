import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NetEvent } from '@officexr/sdk';
import { RealtimeServer } from '../server.ts';
import { WsChannel } from '../ws-channel.ts';
// Note: external consumers go via subpath exports:
//   import { WsChannel } from '@officexr/realtime-server';
//   import { RealtimeServer } from '@officexr/realtime-server/server';
// The internal test imports go through relative paths so they don't
// depend on the exports map being resolved.

function ephemeralPort(): number {
  // 50000-60000 range — avoid privileged ports + common services.
  return 50000 + Math.floor(Math.random() * 10000);
}

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

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('waitFor: predicate did not become true');
}

describe('RealtimeServer + WsChannel roundtrip', () => {
  let port: number;
  let server: RealtimeServer;

  beforeEach(async () => {
    port = ephemeralPort();
    server = new RealtimeServer({ port, officeId: 'test-office' });
    await server.start();
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
    await waitFor(() => received.length > 0);

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
    await waitFor(() => aPresence.some((p) => p.joined.includes('B')));
    expect(a.listPresent()).toContain('B');

    // B disconnects — A sees a leave.
    b.close();
    await waitFor(() => aPresence.some((p) => p.left.includes('B')));
    expect(a.listPresent()).not.toContain('B');

    a.close();
  });

  it('late joiner receives a snapshot of existing peer positions', async () => {
    const url = `ws://127.0.0.1:${port}/ws`;
    const a = new WsChannel({ url, userId: 'A' });
    await a.subscribe();
    await a.send(makeMoveEvent('A', 7));
    // Give the server's mirror a moment to apply the event.
    await waitFor(
      () => server.store.getState().players['A']?.pos.x === 7,
      2000,
    );

    const b = new WsChannel({ url, userId: 'B' });
    const received: NetEvent[] = [];
    b.on((ev) => received.push(ev));
    await b.subscribe();

    await waitFor(() => received.some((e) => e.actorId === 'A'));
    const snap = received.find((e) => e.actorId === 'A');
    expect(snap?.kind).toBe('presence:position');
    if (snap?.kind === 'presence:position') {
      expect(snap.pos.x).toBeCloseTo(7);
    }

    a.close();
    b.close();
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

    await waitFor(() => seen.length > 0);
    expect(seen[0]).toEqual({ kind: 'bots:set-count', payload: { n: 3 } });

    a.close();
  });
});
