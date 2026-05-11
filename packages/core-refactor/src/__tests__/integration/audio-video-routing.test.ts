import { describe, it, expect } from 'vitest';
import {
  createMultiClientHarness,
  type ClientHandle,
} from '@officexr/sdk/test-harness';
import { Communication, MockVoiceAdapter } from '../../communication/index.ts';

/**
 * Verifies that Communication picks the lex-min room across mutually
 * nearby peers. Proximity events used to come from the SDK's collision
 * rule pass; they now come from a Rapier sensor bridge in the
 * debug-app. The Communication module itself is bus-agnostic, so these
 * tests just emit the `proximity:entered` / `proximity:exited` events
 * directly to exercise the lex-min logic without needing a physics
 * world.
 */

interface CommNode {
  client: ClientHandle;
  voice: MockVoiceAdapter;
  comm: Communication;
}

function attachComm(client: ClientHandle): CommNode {
  const voice = new MockVoiceAdapter();
  const comm = new Communication({
    selfId: client.id,
    store: client.store,
    actions: client.actions,
    bus: client.bus,
    voice,
  });
  comm.start();
  return { client, voice, comm };
}

/** Tell every client in `nodes` that every *other* client just
 * entered its proximity inner ring. */
function joinAll(nodes: CommNode[]): void {
  for (const n of nodes) {
    for (const other of nodes) {
      if (other === n) continue;
      n.client.bus.emit({ kind: 'proximity:entered', otherId: other.client.id });
    }
  }
}

describe('integration: audio-video routing', () => {
  it('two clients walking into shared bubble both join the same lex-min room', async () => {
    const h = createMultiClientHarness();
    const A = await h.add('alice');
    const B = await h.add('bob');
    h.ensureMutualPresence();

    const nodes = [attachComm(A), attachComm(B)];
    joinAll(nodes);

    expect(nodes[0].voice.getCurrentRoom()).toBe('room-alice');
    expect(nodes[1].voice.getCurrentRoom()).toBe('room-alice');
    expect(A.store.getState().players['alice'].jitsiRoom).toBe('room-alice');
    expect(B.store.getState().players['bob'].jitsiRoom).toBe('room-alice');
  });

  it('moving out of the bubble drops both clients from the room', async () => {
    const h = createMultiClientHarness();
    const A = await h.add('alice');
    const B = await h.add('bob');
    h.ensureMutualPresence();
    const nodes = [attachComm(A), attachComm(B)];

    joinAll(nodes);
    expect(nodes[0].voice.getCurrentRoom()).toBe('room-alice');

    // Both clients see the other leave proximity.
    A.bus.emit({ kind: 'proximity:exited', otherId: 'bob' });
    B.bus.emit({ kind: 'proximity:exited', otherId: 'alice' });

    expect(nodes[0].voice.getCurrentRoom()).toBeNull();
    expect(nodes[1].voice.getCurrentRoom()).toBeNull();
  });

  it('three-way bubble: all three converge on room-alice', async () => {
    const h = createMultiClientHarness();
    const A = await h.add('alice');
    const B = await h.add('bob');
    const C = await h.add('charlie');
    h.ensureMutualPresence();
    const nodes = [attachComm(A), attachComm(B), attachComm(C)];

    joinAll(nodes);

    for (const n of nodes) {
      expect(n.voice.getCurrentRoom()).toBe('room-alice');
    }
  });
});
