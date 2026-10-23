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

  it('starts held on request and keeps self out of snapshot offers while held', async () => {
    const hub = createInMemoryChannelHub();
    const local = createPersistentLocalState({ selfId: 'alice', officeId: 'office' });
    const office = await startOfficeSync({
      local,
      channel: new InMemoryChannel(hub, 'alice'),
      voice: new MockVoiceAdapter(),
      holdSelf: true,
    });
    local.actions.upsertPlayer({ id: 'carol', name: 'Carol' });
    expect(office.sync.isSelfHeld()).toBe(true);

    const bobLocal = createPersistentLocalState({ selfId: 'bob', officeId: 'office' });
    const bob = await startOfficeSync({
      local: bobLocal,
      channel: new InMemoryChannel(hub, 'bob'),
      voice: new MockVoiceAdapter(),
    });
    await bob.handshake.requestSnapshot();
    const peers = () => Object.keys(bobLocal.store.getState().players);
    expect(peers()).toContain('carol');
    expect(peers()).not.toContain('alice');

    office.stop();
    bob.stop();
  });
});
