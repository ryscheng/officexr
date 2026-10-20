import { EventEmitter } from 'node:events';
import type IJitsiMeetExternalApi from '@jitsi/react-sdk/lib/types/IJitsiMeetExternalApi';
import { describe, expect, it } from 'vitest';
import { JaasVoiceAdapter } from './JaasVoiceAdapter';

class FakeJitsiApi extends EventEmitter {
  audioMuted = false;
  disposed = false;
  executeCommand(name: string) {
    if (name === 'toggleAudio') {
      this.audioMuted = !this.audioMuted;
    }
  }
  isAudioMuted() {
    return Promise.resolve(this.audioMuted);
  }
  dispose() {
    this.disposed = true;
  }
}

const asApi = (fake: FakeJitsiApi) => fake as unknown as IJitsiMeetExternalApi;

function setup() {
  const voice = new JaasVoiceAdapter({ appId: 'app', jwt: Promise.resolve('jwt'), displayName: 'Alice' });
  const states: string[] = [];
  voice.on('connection-state-change', ({ state }) => states.push(state));
  return { voice, states };
}

describe('JaasVoiceAdapter', () => {
  it('connects once the meeting for the current room joins, and disposes it on leave', async () => {
    const { voice, states } = setup();
    const api = new FakeJitsiApi();
    await voice.joinRoom('room-a');
    voice.attachApi('room-a', asApi(api));
    api.emit('videoConferenceJoined');
    expect(states).toEqual(['joining', 'connected']);

    await voice.leaveRoom();
    expect(api.disposed).toBe(true);
    expect(voice.getCurrentRoom()).toBeNull();
    expect(states.at(-1)).toBe('idle');
  });

  it('applies a mute made while the meeting was loading once it joins', async () => {
    const { voice } = setup();
    const api = new FakeJitsiApi();
    await voice.joinRoom('room-a');
    voice.setMuted(true);
    voice.attachApi('room-a', asApi(api));
    api.emit('videoConferenceJoined');
    await new Promise((r) => setTimeout(r, 0));
    expect(api.audioMuted).toBe(true);
  });

  it('ignores a meeting that loads after the room changed', async () => {
    const { voice } = setup();
    await voice.joinRoom('room-a');
    await voice.joinRoom('room-b');
    voice.attachApi('room-a', asApi(new FakeJitsiApi()));
    expect(voice.api).toBeNull();
  });

  it('mutes the live meeting without toggling it twice', async () => {
    const { voice } = setup();
    const api = new FakeJitsiApi();
    await voice.joinRoom('room-a');
    voice.attachApi('room-a', asApi(api));
    voice.setMuted(true);
    voice.setMuted(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(api.audioMuted).toBe(true);
  });
});
