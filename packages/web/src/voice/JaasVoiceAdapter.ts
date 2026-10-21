import type IJitsiMeetExternalApi from '@jitsi/react-sdk/lib/types/IJitsiMeetExternalApi';
import {
  VoiceEventEmitter,
  type VoiceAdapter,
  type VoiceAdapterEventName,
  type VoiceAdapterEvents,
  type VoiceConnectionState,
} from '@officexr/core-refactor';

const MAX_MUTE_CORRECTIONS = 4;
export interface JaasVoiceOptions {
  appId: string;
  jwt: Promise<string>;
  displayName: string;
}

/** What `<JaasMeeting>` renders for the current room. */
export interface JaasMeetingTarget {
  /** Unique per meeting, so re-joining the same room remounts the iframe. */
  key: number;
  roomName: string;
  jwt: string;
}

/**
 * Jitsi room names become XMPP JIDs, so the derived room id (which embeds
 * logins like `a@b.co`) is hashed rather than escaped: escaping can make two
 * distinct rooms collide.
 */
export async function jitsiRoomName(room: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(room));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `officexr-${hex.slice(0, 32)}`;
}

/**
 * Audio-only JaaS voice. Holds the room `Communication` picked; `<JaasMeeting>`
 * renders the Jitsi iframe for {@link getMeeting} and hands back its API via
 * {@link attachApi}.
 */
export class JaasVoiceAdapter implements VoiceAdapter {
  private api: IJitsiMeetExternalApi | null = null;
  private joined = false;
  /** Jitsi's own mute state, as last commanded or reported. */
  private jitsiMuted = false;
  private corrections = 0;
  private room: string | null = null;
  private meeting: JaasMeetingTarget | null = null;
  private meetingCount = 0;
  private state: VoiceConnectionState = 'idle';
  private muted = false;
  private events = new VoiceEventEmitter('jaas-voice-adapter');
  private meetingListeners = new Set<() => void>();

  constructor(readonly options: JaasVoiceOptions) {
    options.jwt.catch((err: unknown) => console.error('JaaS JWT generation failed:', err));
  }

  async joinRoom(roomId: string | null): Promise<void> {
    if (roomId === null) {
      return this.leaveRoom();
    }
    if (roomId === this.room && this.state !== 'error') {
      return;
    }
    this.room = roomId;
    this.setMeeting(null);
    this.setState('joining');
    try {
      const [jwt, roomName] = await Promise.all([this.options.jwt, jitsiRoomName(roomId)]);
      if (this.room === roomId) {
        this.setMeeting({ key: ++this.meetingCount, roomName, jwt });
      }
    } catch (err) {
      console.error('Could not join the JaaS room:', err);
      if (this.room === roomId) {
        this.setState('error');
      }
    }
  }

  async leaveRoom(): Promise<void> {
    if (this.room === null) {
      return;
    }
    this.room = null;
    this.setMeeting(null);
    this.setState('idle');
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.corrections = 0;
    this.applyMute();
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

  getMeeting(): JaasMeetingTarget | null {
    return this.meeting;
  }

  onMeetingChange(listener: () => void): () => void {
    this.meetingListeners.add(listener);
    return () => {
      this.meetingListeners.delete(listener);
    };
  }

  /**
   * Called once the iframe for `meeting` is ready, with the mute state it was
   * started with. A meeting that is no longer current is disposed.
   */
  attachApi(meeting: JaasMeetingTarget, api: IJitsiMeetExternalApi, startMuted: boolean): void {
    if (meeting !== this.meeting) {
      api.dispose();
      return;
    }
    const roomId = this.room!;
    this.api = api;
    this.joined = false;
    this.jitsiMuted = startMuted;
    const ifCurrent =
      <T>(fn: (payload: T) => void) =>
      (payload: T) => {
        if (this.api === api) {
          fn(payload);
        }
      };
    api.on(
      'videoConferenceJoined',
      ifCurrent(() => {
        this.joined = true;
        this.setState('connected');
        this.applyMute();
      }),
    );
    api.on(
      'audioMuteStatusChanged',
      ifCurrent(({ muted }: { muted: boolean }) => {
        this.jitsiMuted = muted;
        // Reports can trail quick toggles; reconciling on each one converges on the last.
        // Capped so a mic Jitsi can't unmute (no permission, moderator mute) isn't toggled forever.
        if (this.corrections < MAX_MUTE_CORRECTIONS) {
          this.corrections++;
          this.applyMute();
        }
      }),
    );
    api.on(
      'videoConferenceLeft',
      ifCurrent(() => {
        this.joined = false;
        this.setState('error');
      }),
    );
    api.on(
      'errorOccurred',
      ifCurrent(({ isFatal }: { isFatal?: boolean }) => {
        if (isFatal) {
          this.joined = false;
          this.setState('error');
        }
      }),
    );
    api.on(
      'participantJoined',
      ifCurrent(({ id }: { id: string }) => this.events.emit('remote-participant-joined', { roomId, participantId: id })),
    );
    api.on(
      'participantLeft',
      ifCurrent(({ id }: { id: string }) => this.events.emit('remote-participant-left', { roomId, participantId: id })),
    );
  }

  on<K extends VoiceAdapterEventName>(name: K, handler: (payload: VoiceAdapterEvents[K]) => void): () => void {
    return this.events.on(name, handler);
  }

  dispose(): void {
    void this.leaveRoom();
    this.events.clear();
    this.meetingListeners.clear();
  }

  // The IFrame API can only toggle, and answers queries only once joined, so
  // compare against the tracked state instead of asking.
  private applyMute(): void {
    if (this.api && this.joined && this.jitsiMuted !== this.muted) {
      this.api.executeCommand('toggleAudio');
      this.jitsiMuted = this.muted;
    }
  }

  private setMeeting(meeting: JaasMeetingTarget | null): void {
    // `<JaaSMeeting>` never disposes its API on unmount, which would leak its window listeners.
    const api = this.api;
    this.api = null;
    this.joined = false;
    api?.dispose();
    this.meeting = meeting;
    for (const listener of [...this.meetingListeners]) {
      listener();
    }
  }

  private setState(state: VoiceConnectionState): void {
    this.state = state;
    this.events.emit('connection-state-change', { state, roomId: this.room });
  }
}
