import { describe, expect, it } from 'vitest';
import { createInMemoryChannelHub, InMemoryChannel } from '@officexr/sdk';
import { MockVoiceAdapter } from '../communication/index.ts';
import { createPersistentLocalState, startOfficeSync } from './index.ts';

describe('startOfficeSync', () => {
  it('mirrors the channel status into store.realtime.status', async () => {
    const local = createPersistentLocalState({ selfId: 'alice', officeId: 'office' });
    const channel = new InMemoryChannel(createInMemoryChannelHub(), 'alice');
    const status = () => local.store.getState().realtime.status;
    expect(status()).toBe('connecting');

    const office = await startOfficeSync({ local, channel, voice: new MockVoiceAdapter() });
    expect(status()).toBe('live');

    // `closed` is not a status the room shows.
    channel.close();
    expect(status()).toBe('live');
    office.stop();
  });
});
