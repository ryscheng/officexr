import { describe, it, expect } from 'vitest';
import {
  createInMemoryChannelHub,
  InMemoryChannel,
  SupabaseChannel,
} from '@officexr/sdk';
import { createClient } from '@supabase/supabase-js';
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

  it('supabase mode returns SupabaseChannel and a working VoiceAdapter', () => {
    // Constructing a Supabase client doesn't open any sockets — that
    // happens on `channel.subscribe()`. So this is a pure object-shape
    // assertion and runs without any infra.
    const supabase = createClient('http://127.0.0.1:54321', 'test-anon-key');
    const stack = createStack({
      mode: 'supabase',
      supabase,
      officeId: 'office-test',
      selfId: 'alice',
    });
    expect(stack.channel).toBeInstanceOf(SupabaseChannel);
    expect(typeof stack.voiceAdapter.joinRoom).toBe('function');
  });
});
