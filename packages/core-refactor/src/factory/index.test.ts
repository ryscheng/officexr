import { describe, it, expect } from 'vitest';
import { createInMemoryChannelHub, InMemoryChannel } from '@officexr/sdk';
import { createStack } from './index.ts';

describe('createStack', () => {
  it('local mode returns InMemoryChannel', () => {
    const hub = createInMemoryChannelHub();
    const stack = createStack({ mode: 'local', hub, selfId: 'alice' });
    expect(stack.channel).toBeInstanceOf(InMemoryChannel);
  });

  it('local mode returns VoiceAdapter', () => {
    const hub = createInMemoryChannelHub();
    const stack = createStack({ mode: 'local', hub, selfId: 'alice' });
    expect(typeof stack.voiceAdapter.joinRoom).toBe('function');
    expect(typeof stack.voiceAdapter.leaveRoom).toBe('function');
    expect(typeof stack.voiceAdapter.getCurrentRoom).toBe('function');
    expect(typeof stack.voiceAdapter.getConnectionState).toBe('function');
    expect(typeof stack.voiceAdapter.on).toBe('function');
    expect(typeof stack.voiceAdapter.dispose).toBe('function');
  });

  it('supabase mode voiceAdapter throws on joinRoom', async () => {
    const stack = createStack({ mode: 'supabase' });
    await expect(stack.voiceAdapter.joinRoom('x')).rejects.toThrow('not implemented');
  });

  it('supabase mode channel is defined', () => {
    const stack = createStack({ mode: 'supabase' });
    expect(stack.channel).toBeDefined();
    expect(stack.channel).not.toBeNull();
  });
});
