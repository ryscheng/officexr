import { describe, it, expect } from 'vitest';
import {
  createMultiClientHarness,
  type ClientHandle,
} from '@officexr/sdk/test-harness';
import { Communication, MockVoiceAdapter } from '../../communication/index.ts';
import { BUBBLE_RADIUS } from '@officexr/sdk';

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

describe('integration: audio-video routing', () => {
  it('two clients walking into shared bubble both join the same lex-min room', async () => {
    const h = createMultiClientHarness();
    const A = await h.add('alice');
    const B = await h.add('bob');
    h.ensureMutualPresence();

    const nodes = [attachComm(A), attachComm(B)];

    // Both at origin → they're already inside each other's bubble
    h.tick();

    // Both adapters should now be in the same lex-min room
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

    h.tick();
    expect(nodes[0].voice.getCurrentRoom()).toBe('room-alice');

    // Move alice far away
    A.actions.setSelfPosition(
      { x: BUBBLE_RADIUS * 5, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      0,
    );
    // B needs to know about A's new position; sync engine handles it.
    h.flush();
    // Tick rules on both clients
    h.tick();

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
    h.tick();
    for (const n of nodes) {
      expect(n.voice.getCurrentRoom()).toBe('room-alice');
    }
  });
});
