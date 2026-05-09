import type { PlayerId } from '@officexr/sdk';

export type VoiceConnectionState =
  | 'idle'
  | 'joining'
  | 'connected'
  | 'reconnecting'
  | 'error';

export interface VoiceAdapterEvents {
  'connection-state-change': { state: VoiceConnectionState; roomId: string | null };
  'remote-participant-joined': { roomId: string; participantId: string };
  'remote-participant-left': { roomId: string; participantId: string };
}

export type VoiceAdapterEventName = keyof VoiceAdapterEvents;

export interface VoiceAdapter {
  /** Switch into the given room (joining if not already). null = leave room. */
  joinRoom(roomId: string | null, opts?: { selfId: PlayerId }): Promise<void>;
  leaveRoom(): Promise<void>;
  setMuted(muted: boolean): void;
  getCurrentRoom(): string | null;
  getConnectionState(): VoiceConnectionState;
  on<K extends VoiceAdapterEventName>(
    name: K,
    handler: (payload: VoiceAdapterEvents[K]) => void,
  ): () => void;
  dispose(): void;
}
