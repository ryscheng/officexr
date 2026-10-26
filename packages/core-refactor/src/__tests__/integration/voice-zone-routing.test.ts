import { describe, it, expect, vi } from 'vitest';
import { createMultiClientHarness } from '@officexr/sdk/test-harness';
import { Communication, MockVoiceAdapter } from '../../communication/index.ts';

describe('integration: voice zone routing', () => {
  it('two clients far apart in the same zone converge on the zone room', async () => {
    const h = createMultiClientHarness();
    const A = await h.add('alice');
    const B = await h.add('bob');
    h.ensureMutualPresence();
    vi.useFakeTimers();

    const zone = { id: 'lounge', label: 'Lounge', min: { x: 0, z: 0 }, max: { x: 100, z: 100 } };
    const voices = [A, B].map((client) => {
      const voice = new MockVoiceAdapter();
      new Communication({
        officeId: 'o1',
        selfId: client.id,
        store: client.store,
        actions: client.actions,
        bus: client.bus,
        voice,
      }).start();
      client.actions.setVoiceZones([zone]);
      return voice;
    });
    const still = { x: 0, y: 0, z: 0 };
    A.actions.setSelfPosition({ x: 1, y: 0, z: 1 }, still, 0, false);
    B.actions.setSelfPosition({ x: 99, y: 0, z: 99 }, still, 0, false);
    vi.advanceTimersByTime(500);
    vi.useRealTimers();

    expect(voices.map((v) => v.getCurrentRoom())).toEqual(['zone-o1-lounge', 'zone-o1-lounge']);
  });
});
