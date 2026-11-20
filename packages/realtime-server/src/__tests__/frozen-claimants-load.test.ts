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

it('first joiner of a room receives the claimants the backend GET returned', async () => {
  const backend: Server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({ claims: { d1: 'bob@x.io' }, claimants: { 'bob@x.io': { characterId: 'Mage' } } }),
    );
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
  const channel = new WsChannel({ url: `ws://127.0.0.1:${server.boundPort}/ws`, userId: 'ann@x.io', officeId: 'o1' });
  cleanups.push(() => channel.close());
  const events: NetEvent[] = [];
  channel.on((e) => events.push(e));
  await channel.subscribe();
  await new Promise((r) => setTimeout(r, 200));
  const claimsEvents = events.filter((e): e is Extract<NetEvent, { kind: 'desk:claims' }> => e.kind === 'desk:claims');
  expect(claimsEvents.at(-1)?.claims).toEqual({ d1: 'bob@x.io' });
  expect(claimsEvents.at(-1)?.claimants).toEqual({ 'bob@x.io': { characterId: 'Mage' } });
});
