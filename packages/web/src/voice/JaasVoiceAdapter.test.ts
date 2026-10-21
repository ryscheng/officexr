import { EventEmitter } from 'node:events';
import type IJitsiMeetExternalApi from '@jitsi/react-sdk/lib/types/IJitsiMeetExternalApi';
import { describe, expect, it, vi } from 'vitest';
import { JaasVoiceAdapter, jitsiRoomName } from './JaasVoiceAdapter';

class FakeJitsiApi extends EventEmitter {
  toggles = 0;
  audioMuted = false;
  disposed = false;
  /** `audioMuteStatusChanged` reports not yet delivered. */
  private reports: boolean[] = [];
  executeCommand(name: string) {
    if (name === 'toggleAudio') {
      this.toggles++;
      this.audioMuted = !this.audioMuted;
      this.reports.push(this.audioMuted);
    }
  }
  deliverReports() {
    while (this.reports.length > 0) {
      this.emit('audioMuteStatusChanged', { muted: this.reports.shift() });
    }
  }
  dispose() {
    this.disposed = true;
  }
}

const asApi = (fake: FakeJitsiApi) => fake as unknown as IJitsiMeetExternalApi;

function setup(jwt: Promise<string> = Promise.resolve('jwt')) {
  const voice = new JaasVoiceAdapter({ appId: 'app', jwt, displayName: 'Alice' });
  const states: string[] = [];
  voice.on('connection-state-change', ({ state }) => states.push(state));
  return { voice, states };
}

async function joinedMeeting(voice: JaasVoiceAdapter, room = 'room-a', startMuted = false) {
  await voice.joinRoom(room);
  const api = new FakeJitsiApi();
  voice.attachApi(voice.getMeeting()!, asApi(api), startMuted);
  api.emit('videoConferenceJoined');
  return api;
}

describe('jitsiRoomName', () => {
  it('keeps rooms apart that escaping would merge', async () => {
    const a = await jitsiRoomName('room-o1-a.b@x.com');
    const b = await jitsiRoomName('room-o1-a-b@x.com');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^officexr-[0-9a-f]{32}$/);
  });
});

describe('JaasVoiceAdapter', () => {
  it('connects once the meeting joins, and disposes it on leave', async () => {
    const { voice, states } = setup();
    const api = await joinedMeeting(voice);
    expect(states).toEqual(['joining', 'connected']);

    await voice.leaveRoom();
    expect(api.disposed).toBe(true);
    expect(voice.getMeeting()).toBeNull();
    expect(states.at(-1)).toBe('idle');
  });

  it('disposes a meeting that loads after the room changed', async () => {
    const { voice } = setup();
    await voice.joinRoom('room-a');
    const stale = voice.getMeeting()!;
    await voice.joinRoom('room-b');
    const api = new FakeJitsiApi();
    voice.attachApi(stale, asApi(api), false);
    expect(api.disposed).toBe(true);
  });

  it('ignores events from a meeting it has moved on from', async () => {
    const { voice, states } = setup();
    const api = await joinedMeeting(voice);
    await voice.joinRoom('room-b');
    api.emit('videoConferenceLeft');
    expect(states.at(-1)).toBe('joining');
  });

  it('goes to error when the JWT cannot be minted', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { voice, states } = setup(Promise.reject(new Error('bad key')));
    await voice.joinRoom('room-a');
    expect(states).toEqual(['joining', 'error']);
    expect(voice.getMeeting()).toBeNull();
    error.mockRestore();
  });

  it('rejoins the same room after a fatal error', async () => {
    const { voice } = setup();
    const api = await joinedMeeting(voice);
    const first = voice.getMeeting()!;
    api.emit('errorOccurred', { isFatal: true });
    await voice.joinRoom('room-a');
    expect(voice.getMeeting()).not.toBeNull();
    expect(voice.getMeeting()!.key).not.toBe(first.key);
    expect(api.disposed).toBe(true);
  });

  it('keeps the call up and mute working on a non-fatal error', async () => {
    const { voice, states } = setup();
    const api = await joinedMeeting(voice);
    api.emit('errorOccurred', { isFatal: false });
    voice.setMuted(true);
    expect(states.at(-1)).toBe('connected');
    expect(api.audioMuted).toBe(true);
  });

  it('ends on the clicked mute state when Jitsi reports trail quick toggles', async () => {
    const { voice } = setup();
    const api = await joinedMeeting(voice);
    voice.setMuted(true);
    voice.setMuted(false);
    voice.setMuted(true);
    api.deliverReports();
    expect(api.audioMuted).toBe(true);
    voice.setMuted(false);
    api.deliverReports();
    expect(api.audioMuted).toBe(false);
  });

  it('goes to error when the conference drops', async () => {
    const { voice, states } = setup();
    const api = await joinedMeeting(voice);
    api.emit('videoConferenceLeft');
    expect(states.at(-1)).toBe('error');
  });

  it('toggles the live meeting once per change of mind', async () => {
    const { voice } = setup();
    const api = await joinedMeeting(voice);
    voice.setMuted(true);
    voice.setMuted(true);
    expect(api.toggles).toBe(1);
    voice.setMuted(false);
    expect(api.toggles).toBe(2);
  });

  it('applies a mute made while the meeting was loading once it joins', async () => {
    const { voice } = setup();
    await voice.joinRoom('room-a');
    const api = new FakeJitsiApi();
    voice.attachApi(voice.getMeeting()!, asApi(api), false);
    voice.setMuted(true);
    expect(api.toggles).toBe(0);
    api.emit('videoConferenceJoined');
    expect(api.toggles).toBe(1);
  });

  it('holds Jitsi to the button when Jitsi mutes on its own', async () => {
    const { voice } = setup();
    const api = await joinedMeeting(voice);
    api.audioMuted = true;
    api.emit('audioMuteStatusChanged', { muted: true });
    api.deliverReports();
    expect(api.audioMuted).toBe(false);
  });

  it('stops correcting a mic that Jitsi keeps muted', async () => {
    const { voice } = setup();
    const api = await joinedMeeting(voice);
    api.executeCommand = () => {
      api.toggles++;
      api.emit('audioMuteStatusChanged', { muted: true });
    };
    api.emit('audioMuteStatusChanged', { muted: true });
    expect(api.toggles).toBeLessThanOrEqual(4);
  });
});
