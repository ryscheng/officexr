import { afterEach, expect, it } from 'vitest';
import type { NetEvent, PlayerId } from '@officexr/sdk';
import { RealtimeServer } from '../server.ts';
import { WsChannel } from '../ws-channel.ts';

const ANN = 'ann@x.io';
const BOB = 'bob@x.io';
const CY = 'cy@x.io';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

const settle = () => new Promise((r) => setTimeout(r, 150));

async function setup(blocked: Record<string, string[]> = {}) {
  const server = new RealtimeServer({ port: 0, blocks: { blockedBy: async (login) => blocked[login] ?? [] } });
  await server.start();
  cleanups.push(() => server.stop());
  let seq = 0;
  async function join(userId: PlayerId, at: { x: number; z: number }) {
    const channel = new WsChannel({ url: `ws://127.0.0.1:${server.boundPort}/ws`, userId, officeId: 'o1' });
    cleanups.push(() => channel.close());
    const events: NetEvent[] = [];
    const joined: PlayerId[] = [];
    const left: PlayerId[] = [];
    channel.on((e) => events.push(e));
    channel.onPresenceChange((j, l) => {
      joined.push(...j);
      left.push(...l);
    });
    await channel.subscribe();
    channel.trackPresence({});
    const base = { v: 1 as const, actorId: userId, t: Date.now() };
    await channel.send({ ...base, seq: ++seq, kind: 'presence:position', pos: { x: at.x, y: 0, z: at.z }, vel: { x: 0, y: 0, z: 0 }, yaw: 0, isAirborne: false });
    const say = (event: Record<string, unknown>) => channel.send({ ...base, seq: ++seq, ...event } as NetEvent);
    return { channel, events, joined, left, say, of: (kind: string, from?: PlayerId) => events.filter((e) => e.kind === kind && (from === undefined || e.actorId === from)) };
  }
  return { server, join };
}

it('hides two people who block each other from the start: no presence, position, chat or ping either way', async () => {
  const { join } = await setup({ [ANN]: [BOB] });
  const ann = await join(ANN, { x: 0, z: 0 });
  const bob = await join(BOB, { x: 1, z: 0 });
  const cy = await join(CY, { x: 2, z: 0 });
  await settle();
  await bob.say({ kind: 'chat:message', text: 'hi room' });
  await bob.say({ kind: 'ping:send', targetId: ANN });
  await bob.say({ kind: 'emote:send', emote: 'wave' });
  await ann.say({ kind: 'chat:message', text: 'hi from ann' });
  await ann.say({ kind: 'ping:send', targetId: BOB });
  await settle();
  expect(ann.events.filter((e) => e.actorId === BOB)).toEqual([]);
  expect(bob.events.filter((e) => e.actorId === ANN)).toEqual([]);
  expect(ann.joined).not.toContain(BOB);
  expect(bob.joined).not.toContain(ANN);
  expect(ann.joined).toContain(CY);
  expect(cy.of('chat:message', BOB)).toHaveLength(1);
  expect(cy.of('chat:message', ANN)).toHaveLength(1);
  expect(cy.of('presence:position', ANN)).toHaveLength(1);
});

it('a block made while both are in the office removes each from the other, and an unblock brings them back', async () => {
  const blocked: Record<string, string[]> = {};
  const { server, join } = await setup(blocked);
  const ann = await join(ANN, { x: 0, z: 0 });
  const bob = await join(BOB, { x: 1, z: 0 });
  await settle();
  expect(ann.joined).toContain(BOB);

  blocked[ANN] = [BOB];
  await server.refreshBlocks(ANN);
  await settle();
  expect(ann.left).toContain(BOB);
  expect(bob.left).toContain(ANN);

  const before = [ann.events.length, bob.events.length];
  await bob.say({ kind: 'chat:message', text: 'still there?' });
  await ann.say({ kind: 'chat:message', text: 'no' });
  await settle();
  expect([ann.events.length, bob.events.length]).toEqual(before);

  blocked[ANN] = [];
  await server.refreshBlocks(ANN);
  await settle();
  expect(ann.joined.filter((id) => id === BOB)).toHaveLength(2);
  expect(bob.joined.filter((id) => id === ANN)).toHaveLength(1);
  expect(ann.of('presence:position', BOB).length).toBeGreaterThan(0);
  await bob.say({ kind: 'chat:message', text: 'back' });
  await settle();
  expect(ann.of('chat:message', BOB).map((e) => (e as { text: string }).text)).toContain('back');
});

it('a block applies whichever of the two made it, and no one else is affected', async () => {
  const { join } = await setup({ [BOB]: [ANN] });
  const ann = await join(ANN, { x: 0, z: 0 });
  const bob = await join(BOB, { x: 1, z: 0 });
  const cy = await join(CY, { x: 2, z: 0 });
  await settle();
  await ann.say({ kind: 'chat:message', text: 'to all' });
  await settle();
  expect(bob.of('chat:message')).toEqual([]);
  expect(cy.of('chat:message', ANN)).toHaveLength(1);
});

it('nearby chat reaches only players within range', async () => {
  const { join } = await setup();
  const ann = await join(ANN, { x: 0, z: 0 });
  const bob = await join(BOB, { x: 3, z: 0 });
  const cy = await join(CY, { x: 40, z: 0 });
  await settle();
  await ann.say({ kind: 'chat:nearby', text: 'psst' });
  await settle();
  expect(bob.of('chat:nearby', ANN)).toHaveLength(1);
  expect(cy.of('chat:nearby')).toEqual([]);
  expect(ann.of('chat:nearby')).toEqual([]);
});

it('nearby chat stops at the edge of the proximity range and follows movement', async () => {
  const { join } = await setup();
  const ann = await join(ANN, { x: 0, z: 0 });
  const bob = await join(BOB, { x: 7.1, z: 0 });
  await settle();
  await ann.say({ kind: 'chat:nearby', text: 'out' });
  await bob.say({ kind: 'presence:position', pos: { x: 6.7, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0, isAirborne: false });
  await settle();
  await ann.say({ kind: 'chat:nearby', text: 'in' });
  await settle();
  expect(bob.of('chat:nearby').map((e) => (e as { text: string }).text)).toEqual(['in']);
});

it('nearby chat does not cross a block even at arm length', async () => {
  const { join } = await setup({ [ANN]: [BOB] });
  const ann = await join(ANN, { x: 0, z: 0 });
  const bob = await join(BOB, { x: 1, z: 0 });
  const cy = await join(CY, { x: 1, z: 1 });
  await settle();
  await ann.say({ kind: 'chat:nearby', text: 'hello' });
  await bob.say({ kind: 'chat:nearby', text: 'hello back' });
  await settle();
  expect(bob.of('chat:nearby')).toEqual([]);
  expect(ann.of('chat:nearby', BOB)).toEqual([]);
  expect(cy.of('chat:nearby')).toHaveLength(2);
});

it('a direct message reaches only its target, however close the others stand', async () => {
  const { join } = await setup();
  const ann = await join(ANN, { x: 0, z: 0 });
  const bob = await join(BOB, { x: 1, z: 0 });
  const cy = await join(CY, { x: 1, z: 1 });
  await settle();
  await ann.say({ kind: 'chat:direct', targetId: BOB, text: 'just you' });
  await settle();
  expect(bob.of('chat:direct', ANN)).toHaveLength(1);
  expect(cy.of('chat:direct')).toEqual([]);
  expect(ann.of('chat:direct')).toEqual([]);
});

it('a direct message to a blocked person, to oneself, or in someone else name is dropped', async () => {
  const { join } = await setup({ [ANN]: [BOB] });
  const ann = await join(ANN, { x: 0, z: 0 });
  const bob = await join(BOB, { x: 1, z: 0 });
  const cy = await join(CY, { x: 1, z: 1 });
  await settle();
  await ann.say({ kind: 'chat:direct', targetId: BOB, text: 'blocked' });
  await bob.say({ kind: 'chat:direct', targetId: ANN, text: 'blocked too' });
  await cy.say({ kind: 'chat:direct', targetId: CY, text: 'to myself' });
  await cy.say({ kind: 'chat:direct', targetId: BOB, actorId: ANN, text: 'forged' });
  await cy.say({ kind: 'chat:nearby', actorId: ANN, text: 'forged nearby' });
  await settle();
  expect(bob.of('chat:direct')).toEqual([]);
  expect(ann.of('chat:direct')).toEqual([]);
  expect(cy.of('chat:direct')).toEqual([]);
  expect(bob.of('chat:nearby')).toEqual([]);
  expect(ann.of('chat:nearby')).toEqual([]);
});

it('keeps everyone visible when the blocks lookup fails', async () => {
  const server = new RealtimeServer({
    port: 0,
    blocks: {
      blockedBy: async () => {
        throw new Error('db down');
      },
    },
  });
  await server.start();
  cleanups.push(() => server.stop());
  const open = async (userId: PlayerId) => {
    const channel = new WsChannel({ url: `ws://127.0.0.1:${server.boundPort}/ws`, userId, officeId: 'o1' });
    cleanups.push(() => channel.close());
    const events: NetEvent[] = [];
    channel.on((e) => events.push(e));
    await channel.subscribe();
    return { channel, events };
  };
  const ann = await open(ANN);
  const bob = await open(BOB);
  await ann.channel.send({ v: 1, actorId: ANN, seq: 1, t: Date.now(), kind: 'chat:message', text: 'hi' });
  await settle();
  expect(bob.events.filter((e) => e.kind === 'chat:message')).toHaveLength(1);
});
