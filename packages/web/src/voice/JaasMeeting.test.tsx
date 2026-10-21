// @vitest-environment jsdom
import { EventEmitter } from 'node:events';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type IJitsiMeetExternalApi from '@jitsi/react-sdk/lib/types/IJitsiMeetExternalApi';
import { afterEach, describe, expect, it } from 'vitest';
import { ShareScreenToggle } from './JaasMeeting';
import { JaasVoiceAdapter } from './JaasVoiceAdapter';

class FakeJitsiApi extends EventEmitter {
  commands: string[] = [];
  executeCommand(name: string) {
    this.commands.push(name);
  }
  dispose() {}
}

afterEach(cleanup);

const shareButton = () => screen.getByRole('button', { name: 'Share screen' }) as HTMLButtonElement;

describe('ShareScreenToggle', () => {
  it('is disabled outside a call and toggles the share inside one', async () => {
    const voice = new JaasVoiceAdapter({ appId: 'app', jwt: Promise.resolve('jwt'), displayName: 'Alice' });
    render(<ShareScreenToggle voice={voice} />);
    expect(shareButton().disabled).toBe(true);

    const api = new FakeJitsiApi();
    await act(async () => {
      await voice.joinRoom('room-a');
      voice.attachApi(voice.getMeeting()!, api as unknown as IJitsiMeetExternalApi, false);
      api.emit('videoConferenceJoined', { id: 'me' });
    });
    expect(shareButton().disabled).toBe(false);
    fireEvent.click(shareButton());
    expect(api.commands).toEqual(['toggleShareScreen']);

    act(() => void api.emit('screenSharingStatusChanged', { on: true }));
    expect(shareButton().getAttribute('aria-pressed')).toBe('true');

    await act(() => voice.leaveRoom());
    expect(shareButton().disabled).toBe(true);
    expect(shareButton().getAttribute('aria-pressed')).toBe('false');
    expect(api.commands).toEqual(['toggleShareScreen', 'toggleShareScreen']);
  });
});
