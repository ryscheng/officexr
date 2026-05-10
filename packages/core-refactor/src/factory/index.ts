import type { Channel } from '@officexr/sdk';
import { createInMemoryChannelHub, InMemoryChannel } from '@officexr/sdk';
import type { VoiceAdapter } from '../communication/types.ts';
import { LocalVoiceAdapter } from '../adapters/local-voice-adapter.ts';
import { SupabaseVoiceAdapter } from '../adapters/supabase-voice-adapter.ts';

export interface LocalStackConfig {
  mode: 'local';
  hub: ReturnType<typeof createInMemoryChannelHub>;
  selfId: string;
  /** Delay in ms before LocalVoiceAdapter emits remote-participant-joined. Default 300. */
  participantJoinDelay?: number;
  onRoomJoined?: (roomId: string) => void;
  onRoomLeft?: () => void;
}

export interface SupabaseStackConfig {
  mode: 'supabase';
  // fields can be added later; stub throws regardless
}

export type StackConfig = LocalStackConfig | SupabaseStackConfig;

export interface Stack {
  channel: Channel;
  voiceAdapter: VoiceAdapter;
}

/**
 * A stub no-op channel used for the supabase mode until real channel wiring is added.
 */
class NoopChannel implements Channel {
  async subscribe(): Promise<void> {}
  async send(): Promise<void> {}
  on(): () => void {
    return () => {};
  }
  trackPresence(): void {}
  onPresenceChange(): () => void {
    return () => {};
  }
  listPresent(): string[] {
    return [];
  }
  close(): void {}
}

export function createStack(config: StackConfig): Stack {
  if (config.mode === 'local') {
    const channel = new InMemoryChannel(config.hub, config.selfId);
    const voiceAdapter = new LocalVoiceAdapter({
      participantJoinDelay: config.participantJoinDelay,
      onRoomJoined: config.onRoomJoined,
      onRoomLeft: config.onRoomLeft,
    });
    return { channel, voiceAdapter };
  }

  if (config.mode === 'supabase') {
    const channel = new NoopChannel();
    const voiceAdapter = new SupabaseVoiceAdapter();
    return { channel, voiceAdapter };
  }

  // exhaustive check
  const _exhaustive: never = config;
  throw new Error(`Unknown stack mode: ${(_exhaustive as any).mode}`);
}
