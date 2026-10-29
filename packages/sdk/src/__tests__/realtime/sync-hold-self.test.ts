import { describe, expect, it } from 'vitest';
import type { NetEvent } from '../../realtime/protocol.ts';
import { createMultiClientHarness } from '../../test-harness/two-client.ts';

type Harness = ReturnType<typeof createMultiClientHarness>;

function moveBob(h: Harness) {
  h.clients.get('bob')!.actions.setSelfPosition({ x: 3, y: 0, z: 1 }, { x: 1, y: 0, z: 0 }, 0.5, false);
  h.step(1000);
}

describe('SyncEngine holdSelf', () => {
  it('sends nothing about self while held, then announces the current state on release', async () => {
    const h = createMultiClientHarness();
    const alice = await h.add('alice');
    const bob = await h.add('bob', { seedSelf: false, holdSelf: true });
    const fromBob: NetEvent[] = [];
    alice.channel.on((e) => {
      if (e.actorId === 'bob') fromBob.push(e);
    });

    bob.actions.upsertPlayer({ id: 'bob', name: 'Bob' });
    moveBob(h);
    alice.actions.upsertPlayer({ id: 'alice', name: 'Alice2' });
    h.step(1000);

    expect(bob.sync.isSelfHeld()).toBe(true);
    expect(fromBob).toEqual([]);
    expect(alice.store.getState().players['bob']).toBeUndefined();
    expect(bob.store.getState().players['alice']?.name).toBe('Alice2');

    bob.sync.releaseSelf();

    expect(bob.sync.isSelfHeld()).toBe(false);
    expect(fromBob.map((e) => e.kind).sort()).toEqual(['avatar:update', 'presence:position', 'presence:status']);
    expect(alice.store.getState().players['bob']).toMatchObject({
      name: 'Bob',
      pos: { x: 3, y: 0, z: 1 },
    });

    bob.actions.setSelfPosition({ x: 9, y: 0, z: 9 }, { x: 1, y: 0, z: 0 }, 0, false);
    h.step(1000);
    expect(alice.store.getState().players['bob']?.pos).toMatchObject({ x: 9, z: 9 });
  });

  it('still broadcasts world changes while held', async () => {
    const h = createMultiClientHarness();
    const alice = await h.add('alice');
    const bob = await h.add('bob', { seedSelf: false, holdSelf: true });

    bob.actions.setWorldObjects({ cubeSize: 5, instances: [] });

    expect(alice.store.getState().worldObjects.cubeSize).toBe(5);
    expect(alice.store.getState().players['bob']).toBeUndefined();
  });

  it('releaseSelf on an unheld engine sends nothing', async () => {
    const h = createMultiClientHarness();
    const alice = await h.add('alice');
    const bob = await h.add('bob');
    h.ensureMutualPresence();
    const fromBob: NetEvent[] = [];
    alice.channel.on((e) => {
      if (e.actorId === 'bob') fromBob.push(e);
    });

    bob.sync.releaseSelf();

    expect(fromBob).toEqual([]);
  });
});
