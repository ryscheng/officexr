import type { PlayerId } from '@officexr/sdk';
import type {
  VoiceAdapter,
  VoiceAdapterEventName,
  VoiceAdapterEvents,
  VoiceConnectionState,
} from './types.ts';
import { VoiceEventEmitter } from './voice-event-emitter.ts';

/**
 * Test-only voice adapter. Records every joinRoom/leaveRoom/setMuted call
 * and lets tests trigger remote-participant events synchronously.
 */
export class MockVoiceAdapter implements VoiceAdapter {
  public readonly calls: Array<
    | { type: 'joinRoom'; roomId: string | null; selfId?: PlayerId }
    | { type: 'leaveRoom' }
    | { type: 'setMuted'; muted: boolean }
    | { type: 'dispose' }
  > = [];

  private currentRoom: string | null = null;
  private connectionState: VoiceConnectionState = 'idle';
  private events = new VoiceEventEmitter('mock-voice-adapter');
  private disposed = false;

  async joinRoom(roomId: string | null, opts?: { selfId: PlayerId }): Promise<void> {
    this.calls.push({ type: 'joinRoom', roomId, selfId: opts?.selfId });
    if (roomId === null) {
      await this.leaveRoom();
      return;
    }
    if (this.currentRoom === roomId) return;
    this.currentRoom = roomId;
    this.setConnectionState('joining');
    this.setConnectionState('connected');
    this.emitLocalParticipantJoined(`local-${roomId}`);
  }

  async leaveRoom(): Promise<void> {
    this.calls.push({ type: 'leaveRoom' });
    this.currentRoom = null;
    this.setConnectionState('idle');
  }

  setMuted(muted: boolean): void {
    this.calls.push({ type: 'setMuted', muted });
  }

  getCurrentRoom(): string | null {
    return this.currentRoom;
  }

  getConnectionState(): VoiceConnectionState {
    return this.connectionState;
  }

  on<K extends VoiceAdapterEventName>(
    name: K,
    handler: (payload: VoiceAdapterEvents[K]) => void,
  ): () => void {
    return this.events.on(name, handler);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.calls.push({ type: 'dispose' });
    this.events.clear();
  }

  // -- test surface --

  /** Test-only: simulate a remote participant joining; `roomId` overrides the current room to model a stale event. */
  emitParticipantJoined(participantId: PlayerId, displayName = '', roomId = this.currentRoom): void {
    if (!roomId) return;
    this.events.emit('remote-participant-joined', { roomId, participantId, displayName });
  }

  emitParticipantLeft(participantId: PlayerId, roomId = this.currentRoom): void {
    if (!roomId) return;
    this.events.emit('remote-participant-left', { roomId, participantId });
  }

  /** Test-only: emit a connection-state change without touching the current room. */
  emitConnectionState(state: VoiceConnectionState): void {
    this.setConnectionState(state);
  }

  /** Test-only: clear recorded calls. */
  clearCalls(): void {
    this.calls.length = 0;
  }

  /** Emitted by `joinRoom`, after the room's `connected`, like the real adapters. */
  private emitLocalParticipantJoined(participantId: string): void {
    if (!this.currentRoom) return;
    this.events.emit('local-participant-joined', { roomId: this.currentRoom, participantId });
  }

  private setConnectionState(state: VoiceConnectionState): void {
    this.connectionState = state;
    this.events.emit('connection-state-change', { state, roomId: this.currentRoom });
  }
}
