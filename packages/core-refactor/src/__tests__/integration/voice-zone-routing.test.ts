import { afterEach, describe, it, expect, vi } from 'vitest';
import { createMultiClientHarness, type ClientHandle } from '@officexr/sdk/test-harness';
import { Communication, MockVoiceAdapter } from '../../communication/index.ts';

const zone = { id: 'lounge', label: 'Lounge', min: { x: 0, z: 0 }, max: { x: 100, z: 100 } };
const still = { x: 0, y: 0, z: 0 };

function attachComm(client: ClientHandle): MockVoiceAdapter {
  const voice = new MockVoiceAdapter();
  new Communication({
    officeId: 'o1',
    selfId: client.id,
    store: client.store,
    actions: client.actions,
    bus: client.bus,
    voice,
  }).start();
  return voice;
}

describe('integration: voice zone routing', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('two clients far apart in the same zone converge on the zone room', async () => {
    const h = createMultiClientHarness();
    vi.useFakeTimers();
    const A = await h.add('alice');
    A.actions.setVoiceZones([zone]);
    const voiceA = attachComm(A);
    A.actions.setSelfPosition({ x: 1, y: 0, z: 1 }, still, 0, false);

    const B = await h.add('bob');
    B.actions.setVoiceZones([zone]);
    const voiceB = attachComm(B);
    h.flush();
    h.ensureMutualPresence();
    B.actions.setSelfPosition({ x: 99, y: 0, z: 99 }, still, 0, false);
    h.flush();
    vi.advanceTimersByTime(500);

    expect(B.store.getState().voiceZones).toEqual([zone]);
    expect(A.store.getState().players['bob']?.pos.x).toBe(99);
    expect(voiceA.getCurrentRoom()).toBe('zone-o1-lounge');
    expect(voiceB.getCurrentRoom()).toBe('zone-o1-lounge');
  });
});
