import type IJitsiMeetExternalApi from '@jitsi/react-sdk/lib/types/IJitsiMeetExternalApi';
import type {
  VoiceAdapter,
  VoiceAdapterEventName,
  VoiceAdapterEvents,
  VoiceConnectionState,
} from '@officexr/core-refactor';

export interface JaasVoiceOptions {
  appId: string;
  jwt: Promise<string>;
  displayName: string;
}

/**
 * Audio-only JaaS voice. Holds the room `Communication` picked; `<JaasMeeting>`
 * renders the Jitsi iframe for it and hands back the API handle via
 * {@link attachApi}.
 */
export class JaasVoiceAdapter implements VoiceAdapter {
  /** Jitsi IFrame API of the current meeting; null until it loads. */
  api: IJitsiMeetExternalApi | null = null;
  private room: string | null = null;
  private state: VoiceConnectionState = 'idle';
  private muted = false;
  private muteSync = Promise.resolve();
  private handlers = new Map<VoiceAdapterEventName, Set<(payload: never) => void>>();

  constructor(readonly options: JaasVoiceOptions) {}

  async joinRoom(roomId: string | null): Promise<void> {
    if (roomId === null) {
      return this.leaveRoom();
    }
    if (roomId === this.room) {
      return;
    }
    this.room = roomId;
    this.disposeApi();
    this.setState('joining');
  }

  async leaveRoom(): Promise<void> {
    if (this.room === null) {
      return;
    }
    this.room = null;
    this.disposeApi();
    this.setState('idle');
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.syncMute();
  }

  // The IFrame API only toggles, so compare against Jitsi's own state, one
  // check at a time so rapid clicks can't both see the stale state and toggle twice.
  private syncMute(): void {
    this.muteSync = this.muteSync.then(async () => {
      const api = this.api;
      if (api && (await api.isAudioMuted()) !== this.muted) {
        api.executeCommand('toggleAudio');
      }
    });
  }

  isMuted(): boolean {
    return this.muted;
  }

  getCurrentRoom(): string | null {
    return this.room;
  }

  getConnectionState(): VoiceConnectionState {
    return this.state;
  }

  /** Called once the iframe for `roomId` is ready; ignored if the room changed meanwhile. */
  attachApi(roomId: string, api: IJitsiMeetExternalApi): void {
    if (roomId !== this.room) {
      return;
    }
    this.api = api;
    api.on('videoConferenceJoined', () => {
      this.setState('connected');
      // The mic may have been toggled while the iframe was loading.
      this.syncMute();
    });
    api.on('participantJoined', ({ id }: { id: string }) =>
      this.fire('remote-participant-joined', { roomId, participantId: id }),
    );
    api.on('participantLeft', ({ id }: { id: string }) =>
      this.fire('remote-participant-left', { roomId, participantId: id }),
    );
  }

  on<K extends VoiceAdapterEventName>(name: K, handler: (payload: VoiceAdapterEvents[K]) => void): () => void {
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  }

  dispose(): void {
    void this.leaveRoom();
    this.handlers.clear();
  }

  // `<JaaSMeeting>` never disposes its API on unmount, which would leak its window listeners.
  private disposeApi(): void {
    this.api?.dispose();
    this.api = null;
  }

  private setState(state: VoiceConnectionState): void {
    this.state = state;
    this.fire('connection-state-change', { state, roomId: this.room });
  }

  private fire<K extends VoiceAdapterEventName>(name: K, payload: VoiceAdapterEvents[K]): void {
    for (const handler of this.handlers.get(name) ?? []) {
      (handler as (payload: VoiceAdapterEvents[K]) => void)(payload);
    }
  }
}
