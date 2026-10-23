import { afterEach, describe, it, expect, vi } from 'vitest';
import { createMultiClientHarness } from '../../test-harness/two-client.ts';

describe('SyncEngine reload', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies a reloaded peer’s events despite the old high-water mark', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000);
    const h = createMultiClientHarness();
    const alice = await h.add('alice');
    await h.add('bob');
    h.ensureMutualPresence();

    for (let i = 0; i < 20; i++) {
      h.clients.get('bob')!.actions.appendChat({
        id: `m${i}`,
        authorId: 'bob',
        text: `x${i}`,
        t: 0,
      });
    }
    const oldMark = alice.sync.getInboundSeqTable().snapshot()['bob'];
    expect(oldMark).toBeGreaterThan(0);

    vi.setSystemTime(2_000_000);
    h.remove('bob');
    const bob = await h.add('bob', { seedSelf: false });
    bob.actions.upsertPlayer({ id: 'bob', name: 'Bobby' });
    bob.actions.setSelfPosition(
      { x: 4, y: 0, z: 2 },
      { x: 1, y: 0, z: 0 },
      0,
      false,
    );
    h.step(1000);

    expect(alice.store.getState().players['bob']).toMatchObject({
      name: 'Bobby',
      pos: { x: 4, y: 0, z: 2 },
    });
    expect(alice.sync.getInboundSeqTable().snapshot()['bob']).toBeGreaterThan(oldMark);
  });
});
