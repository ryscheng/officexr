import type { Channel } from '@officexr/sdk';
import { createInMemoryChannelHub, InMemoryChannel } from '@officexr/sdk';
import { WsChannel } from '@officexr/realtime-server';
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

export interface WsStackConfig {
  mode: 'ws';
  /** Full WebSocket URL (e.g. `ws://host:8787/ws` or, when going
   * through the Vite dev-server proxy, `${origin}/ws`). */
  url: string;
  selfId: string;
  /** Login that `selfId` is a session of, when it isn't the login itself. */
  login?: string;
  /** Office to join on the server. Omitted means the server's default
   * office. */
  officeId?: string;
  /** Real voice backend. Omitted means the same proximity-driven
   * `LocalVoiceAdapter` as the `local` mode, driving the browser-side
   * elevator audio through the callbacks below. */
  voiceAdapter?: VoiceAdapter;
  onRoomJoined?: (roomId: string) => void;
  onRoomLeft?: () => void;
}

export type StackConfig = LocalStackConfig | WsStackConfig;

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

  if (config.mode === 'ws') {
    const channel = new WsChannel({
      url: config.url,
      userId: config.selfId,
      login: config.login,
      officeId: config.officeId,
    });
    const voiceAdapter =
      config.voiceAdapter ??
      new LocalVoiceAdapter({
        onRoomJoined: config.onRoomJoined,
        onRoomLeft: config.onRoomLeft,
      });
    return { channel, voiceAdapter };
  }

  // exhaustive check
  const _exhaustive: never = config;
  throw new Error(`Unknown stack mode: ${(_exhaustive as any).mode}`);
}
