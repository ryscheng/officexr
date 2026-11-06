import type { Actions } from '@officexr/sdk';
import type { VoiceAdapter } from './types.ts';

interface CallRosterSyncOpts {
  actions: Actions;
  voice: VoiceAdapter;
}

/**
 * Mirrors who is in the voice adapter's current call into `callRoster`, and
 * the local user's own Jitsi participant id into their player state.
 */
export class CallRosterSync {
  private readonly actions: Actions;
  private readonly voice: VoiceAdapter;
  private offs: Array<() => void> = [];
  private lastRoomId: string | null = null;

  constructor(opts: CallRosterSyncOpts) {
    this.actions = opts.actions;
    this.voice = opts.voice;
  }

  start(): void {
    if (this.offs.length > 0) return;
    const { actions, voice } = this;
    this.lastRoomId = voice.getCurrentRoom();
    this.offs = [
      voice.on('local-participant-joined', ({ roomId, participantId }) => {
        if (roomId === voice.getCurrentRoom()) {
          actions.setMyJitsiParticipantId(participantId);
        }
      }),
      voice.on('remote-participant-joined', ({ roomId, participantId, displayName }) => {
        if (roomId === voice.getCurrentRoom()) {
          actions.callParticipantJoined(participantId, displayName);
        }
      }),
      voice.on('remote-participant-left', ({ roomId, participantId }) => {
        if (roomId === voice.getCurrentRoom()) {
          actions.callParticipantLeft(participantId);
        }
      }),
      voice.on('connection-state-change', ({ state, roomId }) => {
        const roomChanged = roomId !== this.lastRoomId;
        this.lastRoomId = roomId;
        if (state !== 'connected' || roomChanged) {
          this.clear();
        }
      }),
    ];
  }

  stop(): void {
    for (const off of this.offs) off();
    this.offs = [];
    this.clear();
  }

  private clear(): void {
    this.actions.clearCallRoster();
    this.actions.setMyJitsiParticipantId(null);
  }
}
