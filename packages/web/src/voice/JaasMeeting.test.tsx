// @vitest-environment jsdom
import { EventEmitter } from 'node:events';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type IJitsiMeetExternalApi from '@jitsi/react-sdk/lib/types/IJitsiMeetExternalApi';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MuteToggle, ShareScreenToggle } from './JaasMeeting';
import { JaasVoiceAdapter } from './JaasVoiceAdapter';

class FakeJitsiApi extends EventEmitter {
  commands: string[] = [];
  executeCommand(name: string) {
    this.commands.push(name);
  }
  dispose() {}
}

afterEach(cleanup);

const newVoice = () => new JaasVoiceAdapter({ appId: 'app', jwt: Promise.resolve('jwt'), displayName: 'Alice' });

async function joinMeeting(voice: JaasVoiceAdapter) {
  const api = new FakeJitsiApi();
  await act(async () => {
    await voice.joinRoom('room-a');
    voice.attachApi(voice.getMeeting()!, api as unknown as IJitsiMeetExternalApi, false);
    api.emit('videoConferenceJoined', { id: 'me' });
  });
  return api;
}

const button = () => screen.getByRole('button') as HTMLButtonElement;
const iconOf = (el: HTMLElement) => el.querySelector('svg')!.getAttribute('class');

describe('MuteToggle', () => {
  it('follows the effective mute and toggles away from it', () => {
    const voice = newVoice();
    const setMuted = vi.spyOn(voice, 'setMuted');
    render(<MuteToggle voice={voice} />);
    expect(button().getAttribute('aria-label')).toBe('Mute microphone');
    expect(button().getAttribute('aria-pressed')).toBe('false');
    expect(iconOf(button())).toContain('lucide-mic ');

    fireEvent.click(button());
    expect(setMuted).toHaveBeenLastCalledWith(true);
    expect(button().getAttribute('aria-label')).toBe('Unmute microphone');
    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(iconOf(button())).toContain('lucide-mic-off');

    fireEvent.click(button());
    expect(setMuted).toHaveBeenLastCalledWith(false);
    expect(button().getAttribute('aria-pressed')).toBe('false');
  });

  it('shows a mute Jitsi holds as muted, and asks to unmute', async () => {
    const voice = newVoice();
    render(<MuteToggle voice={voice} />);
    const api = await joinMeeting(voice);
    api.executeCommand = () => {};
    act(() => {
      for (let i = 0; i < 6; i++) {
        api.emit('audioMuteStatusChanged', { muted: true });
      }
    });
    expect(voice.isMuted()).toBe(false);
    expect(button().getAttribute('aria-label')).toBe('Unmute microphone');
    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(iconOf(button())).toContain('lucide-mic-off');

    const setMuted = vi.spyOn(voice, 'setMuted');
    fireEvent.click(button());
    expect(setMuted).toHaveBeenCalledWith(false);
  });

  it('shows its label as a tooltip on focus and keeps focus off on mousedown', () => {
    render(<MuteToggle voice={newVoice()} />);
    expect(fireEvent.mouseDown(button())).toBe(false);
    act(() => button().focus());
    expect(screen.getByRole('tooltip').textContent).toBe('Mute microphone');
  });
});

describe('ShareScreenToggle', () => {
  it('is disabled outside a call and toggles the share inside one', async () => {
    const voice = newVoice();
    render(<ShareScreenToggle voice={voice} />);
    expect(button().disabled).toBe(true);
    expect(button().getAttribute('aria-label')).toBe('Screen sharing unavailable');

    const api = await joinMeeting(voice);
    expect(button().disabled).toBe(false);
    expect(button().getAttribute('aria-label')).toBe('Share screen');
    expect(button().getAttribute('aria-pressed')).toBe('false');
    expect(iconOf(button())).toContain('lucide-monitor-up');
    fireEvent.click(button());
    expect(api.commands).toEqual(['toggleShareScreen']);

    act(() => void api.emit('screenSharingStatusChanged', { on: true }));
    expect(button().getAttribute('aria-label')).toBe('Stop sharing');
    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(iconOf(button())).toContain('lucide-monitor-off');

    await act(() => voice.leaveRoom());
    expect(button().disabled).toBe(true);
    expect(button().getAttribute('aria-pressed')).toBe('false');
    expect(api.commands).toEqual(['toggleShareScreen', 'toggleShareScreen']);
  });

  it('shows its label as a tooltip on focus and keeps focus off on mousedown', async () => {
    const voice = newVoice();
    render(<ShareScreenToggle voice={voice} />);
    await joinMeeting(voice);
    expect(fireEvent.mouseDown(button())).toBe(false);
    act(() => button().focus());
    expect(screen.getByRole('tooltip').textContent).toBe('Share screen');
  });
});
