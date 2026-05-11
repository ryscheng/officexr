import type {
  VoiceAdapter,
  VoiceAdapterEventName,
  VoiceAdapterEvents,
  VoiceConnectionState,
} from '../communication/types.ts';

export interface LocalVoiceAdapterOptions {
  /** Id to use for the fake remote participant. Default: 'bot-001'. */
  fakeParticipantId?: string;
  /** Delay in ms before emitting remote-participant-joined after joinRoom. Default: 300. */
  participantJoinDelay?: number;
  /** Called synchronously when a room is joined (state transitions to 'connected'). */
  onRoomJoined?: (roomId: string) => void;
  /** Called synchronously when leaveRoom is called (state transitions to 'idle'). */
  onRoomLeft?: () => void;
}

export class LocalVoiceAdapter implements VoiceAdapter {
  private fakeParticipantId: string;
  private participantJoinDelay: number;
  private onRoomJoined?: (roomId: string) => void;
  private onRoomLeft?: () => void;

  private currentRoom: string | null = null;
  private connectionState: VoiceConnectionState = 'idle';
  private handlers = new Map<VoiceAdapterEventName, Set<(payload: any) => void>>();
  private disposed = false;
  private pendingTimeout: ReturnType<typeof setTimeout> | null = null;
  private fakeParticipantJoined = false;

  constructor(options: LocalVoiceAdapterOptions = {}) {
    this.fakeParticipantId = options.fakeParticipantId ?? 'bot-001';
    this.participantJoinDelay = options.participantJoinDelay ?? 300;
    this.onRoomJoined = options.onRoomJoined;
    this.onRoomLeft = options.onRoomLeft;
  }

  async joinRoom(roomId: string | null): Promise<void> {
    if (roomId === null) {
      await this.leaveRoom();
      return;
    }
    if (this.currentRoom === roomId) return;

    this.setConnectionState('joining');
    this.currentRoom = roomId;
    this.setConnectionState('connected');
    this.onRoomJoined?.(roomId);

    this.pendingTimeout = setTimeout(() => {
      if (this.disposed || this.currentRoom !== roomId) return;
      this.fakeParticipantJoined = true;
      this.fire('remote-participant-joined', {
        roomId,
        participantId: this.fakeParticipantId,
      });
    }, this.participantJoinDelay);
  }

  async leaveRoom(): Promise<void> {
    if (!this.currentRoom) return;

    if (this.pendingTimeout !== null) {
      clearTimeout(this.pendingTimeout);
      this.pendingTimeout = null;
    }

    const leftRoom = this.currentRoom;

    if (this.fakeParticipantJoined) {
      this.fire('remote-participant-left', {
        roomId: leftRoom,
        participantId: this.fakeParticipantId,
      });
      this.fakeParticipantJoined = false;
    }

    this.currentRoom = null;
    this.setConnectionState('idle');
    this.onRoomLeft?.();
  }

  setMuted(_muted: boolean): void {
    // no-op; store if needed
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
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    set.add(handler as (payload: any) => void);
    return () => {
      this.handlers.get(name)?.delete(handler as (payload: any) => void);
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.pendingTimeout !== null) {
      clearTimeout(this.pendingTimeout);
      this.pendingTimeout = null;
    }
    this.handlers.clear();
  }

  private setConnectionState(state: VoiceConnectionState): void {
    this.connectionState = state;
    this.fire('connection-state-change', { state, roomId: this.currentRoom });
  }

  private fire<K extends VoiceAdapterEventName>(
    name: K,
    payload: VoiceAdapterEvents[K],
  ): void {
    if (this.disposed) return;
    const set = this.handlers.get(name);
    if (!set) return;
    for (const h of [...set]) {
      try {
        h(payload);
      } catch (err) {
        console.error('[local-voice-adapter] handler threw:', err);
      }
    }
  }
}
