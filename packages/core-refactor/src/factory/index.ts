import type { Channel } from '@officexr/sdk';
import {
  createInMemoryChannelHub,
  InMemoryChannel,
  SupabaseChannel,
} from '@officexr/sdk';
import { WsChannel } from '@officexr/realtime-server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { VoiceAdapter } from '../communication/types.ts';
import { LocalVoiceAdapter } from '../adapters/local-voice-adapter.ts';

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
  /** Pre-built Supabase client. The caller owns its lifetime — createStack
   * does not call removeAllChannels on it. */
  supabase: SupabaseClient;
  officeId: string;
  selfId: string;
  /** Voice callbacks. The debug-app's elevator-music is proximity-driven
   * and routes through these — `LocalVoiceAdapter` is used in both modes
   * because the audio is browser-side and doesn't need a real voice
   * room. A future real `SupabaseVoiceAdapter` can be wired in here. */
  onRoomJoined?: (roomId: string) => void;
  onRoomLeft?: () => void;
}

export interface WsStackConfig {
  mode: 'ws';
  /** Full WebSocket URL (e.g. `ws://host:8787/ws` or, when going
   * through the Vite dev-server proxy, `${origin}/ws`). */
  url: string;
  selfId: string;
  /** Voice callbacks. Same proximity-driven `LocalVoiceAdapter` as the
   * `local` mode — the elevator audio is browser-side and doesn't need
   * a real voice room. */
  onRoomJoined?: (roomId: string) => void;
  onRoomLeft?: () => void;
}

export type StackConfig = LocalStackConfig | SupabaseStackConfig | WsStackConfig;

/** Type-narrow helper: in `ws` mode the returned channel is a {@link
 * WsChannel}, useful when callers need `sendCustom` for app-level
 * protocol extensions. */
export interface WsStack extends Stack {
  channel: WsChannel;
}

export interface Stack {
  channel: Channel;
  voiceAdapter: VoiceAdapter;
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
    const channel = new SupabaseChannel({
      supabase: config.supabase,
      officeId: config.officeId,
      userId: config.selfId,
    });
    const voiceAdapter = new LocalVoiceAdapter({
      onRoomJoined: config.onRoomJoined,
      onRoomLeft: config.onRoomLeft,
    });
    return { channel, voiceAdapter };
  }

  if (config.mode === 'ws') {
    const channel = new WsChannel({ url: config.url, userId: config.selfId });
    const voiceAdapter = new LocalVoiceAdapter({
      onRoomJoined: config.onRoomJoined,
      onRoomLeft: config.onRoomLeft,
    });
    return { channel, voiceAdapter };
  }

  // exhaustive check
  const _exhaustive: never = config;
  throw new Error(`Unknown stack mode: ${(_exhaustive as any).mode}`);
}
