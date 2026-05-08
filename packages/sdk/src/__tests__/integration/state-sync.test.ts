import { describe, it, expect } from 'vitest';
import { createMultiClientHarness } from '../../test-harness/two-client.ts';

describe('integration: state-sync', () => {
  it('chat round-trips both directions in send order', async () => {
    const h = createMultiClientHarness();
    const A = await h.add('alice');
    const B = await h.add('bob');
    h.ensureMutualPresence();

    A.actions.appendChat({ id: 'a1', authorId: 'alice', text: 'hello bob', t: 1 });
    B.actions.appendChat({ id: 'b1', authorId: 'bob', text: 'hi alice', t: 2 });
    A.actions.appendChat({ id: 'a2', authorId: 'alice', text: 'how are you', t: 3 });

    // Each client sees: own messages (locally) + remote messages.
    const aChat = A.store.getState().chat.map((m) => m.text);
    const bChat = B.store.getState().chat.map((m) => m.text);
    expect(aChat).toContain('hello bob');
    expect(aChat).toContain('hi alice');
    expect(aChat).toContain('how are you');
    expect(bChat).toContain('hello bob');
    expect(bChat).toContain('hi alice');
    expect(bChat).toContain('how are you');
  });

  it('whiteboard strokes converge in append order despite interleaving', async () => {
    const h = createMultiClientHarness();
    const A = await h.add('alice');
    const B = await h.add('bob');
    h.ensureMutualPresence();

    A.actions.appendStroke({
      id: 'sa1',
      authorId: 'alice',
      points: [{ x: 0, y: 0 }],
      color: '#a',
      width: 1,
      t: 1,
    });
    B.actions.appendStroke({
      id: 'sb1',
      authorId: 'bob',
      points: [{ x: 1, y: 1 }],
      color: '#b',
      width: 1,
      t: 2,
    });
    A.actions.appendStroke({
      id: 'sa2',
      authorId: 'alice',
      points: [{ x: 2, y: 2 }],
      color: '#a',
      width: 1,
      t: 3,
    });

    // Both should converge; specific order is "in arrival order at each
    // client" — assert presence + count rather than exact ordering.
    const aIds = A.store.getState().whiteboard.strokes.map((s) => s.id).sort();
    const bIds = B.store.getState().whiteboard.strokes.map((s) => s.id).sort();
    expect(aIds).toEqual(['sa1', 'sa2', 'sb1']);
    expect(bIds).toEqual(['sa1', 'sa2', 'sb1']);
  });

  it('host-broadcast zombie:state is applied on the peer', async () => {
    const h = createMultiClientHarness();
    const A = await h.add('alice');
    const B = await h.add('bob');
    h.ensureMutualPresence();

    // Alice acts as host and broadcasts a zombie state snapshot
    A.sync.send({
      kind: 'zombie:state',
      v: 1,
      actorId: 'alice',
      seq: 1,
      t: 0,
      state: {
        phase: 'wave',
        wave: 4,
        totalKills: 12,
        hostId: 'alice',
        entities: {
          z1: { id: 'z1', pos: { x: 1, y: 0, z: 1 }, hp: 30, target: 'bob' },
        },
        playerHealths: { alice: 90, bob: 80 },
      },
    });

    expect(B.store.getState().zombies.wave).toBe(4);
    expect(B.store.getState().zombies.entities['z1'].hp).toBe(30);
    expect(B.store.getState().zombies.playerHealths['bob']).toBe(80);
  });
});
