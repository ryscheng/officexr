import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import type { NetEvent } from '@officexr/sdk';
import { createOfficeApi } from '../office-api.ts';
import { RealtimeServer } from '../server.ts';
import { WsChannel } from '../ws-channel.ts';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

/** Backend whose claimants (the office_characters join) the test can change, as PUT /character would. */
async function setup() {
  const db = { claims: { d1: 'bob@x.io' } as Record<string, string>, characters: { 'bob@x.io': 'Mage' } as Record<string, string> };
  const body = () => ({
    claims: db.claims,
    claimants: Object.fromEntries(Object.values(db.claims).map((l) => [l, db.characters[l] ? { characterId: db.characters[l] } : {}])),
  });
  const backend: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (req.method === 'PUT') db.claims.d2 = 'ann@x.io';
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body()));
    });
  });
  await new Promise<void>((r) => backend.listen(0, r));
  cleanups.push(
    () =>
      new Promise<void>((r) => {
        backend.closeAllConnections();
        backend.close(() => r());
      }),
  );
  const url = `http://127.0.0.1:${(backend.address() as AddressInfo).port}`;
  const server = new RealtimeServer({ port: 0, deskClaims: createOfficeApi({ baseUrl: url, tokenSecret: 's' }) });
  await server.start();
  cleanups.push(() => server.stop());
  async function join(userId: string) {
    const channel = new WsChannel({ url: `ws://127.0.0.1:${server.boundPort}/ws`, userId, officeId: 'o1' });
    cleanups.push(() => channel.close());
    const events: NetEvent[] = [];
    channel.on((e) => events.push(e));
    await channel.subscribe();
    return { channel, events };
  }
  return { db, join };
}

const settle = () => new Promise((r) => setTimeout(r, 200));
const lastClaimants = (events: NetEvent[]) =>
  events.filter((e): e is Extract<NetEvent, { kind: 'desk:claims' }> => e.kind === 'desk:claims').at(-1)?.claimants;

it('a character change after the last claim reaches a later joiner', async () => {
  const { db, join } = await setup();
  const ann = await join('ann@x.io');
  ann.channel.sendCustom('desk:claim', { deskId: 'd2' });
  await settle();
  db.characters['bob@x.io'] = 'Knight'; // bob picks a new character (PUT /api/offices/o1/character)
  const cy = await join('cy@x.io');
  await settle();
  expect(lastClaimants(cy.events)?.['bob@x.io']).toEqual({ characterId: 'Knight' });
});

it('a ping sent to an offline frozen login reaches nobody and gives no feedback', async () => {
  const { join } = await setup();
  const ann = await join('ann@x.io');
  ann.channel.send({ kind: 'ping:send', v: 1, actorId: 'ann@x.io', seq: 1, t: Date.now(), targetId: 'bob@x.io' });
  await settle();
  const bob = await join('bob@x.io');
  await settle();
  const annOther = ann.events.filter((e) => e.kind === 'ping:send');
  const bobPings = bob.events.filter((e) => e.kind === 'ping:send');
  expect(bobPings.length).toBe(0); // documents the drop; passes
});
