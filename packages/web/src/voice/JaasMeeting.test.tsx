// @vitest-environment jsdom
import { EventEmitter } from 'node:events';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type IJitsiMeetExternalApi from '@jitsi/react-sdk/lib/types/IJitsiMeetExternalApi';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JaasMeeting, MuteToggle, ShareScreenToggle } from './JaasMeeting';
import { JaasVoiceAdapter, MAX_MUTE_CORRECTIONS } from './JaasVoiceAdapter';

class FakeJitsiApi extends EventEmitter {
  commands: string[] = [];
  executeCommand(name: string) {
    this.commands.push(name);
  }
  dispose() {}
}

vi.mock('@jitsi/react-sdk', () => ({
  JaaSMeeting: ({ getIFrameRef }: { getIFrameRef?: (parent: HTMLDivElement) => void }) => (
    <div data-testid="jitsi" ref={(node) => void (node && getIFrameRef?.(node))} />
  ),
}));

const stubPointer = (coarse: boolean) =>
  vi.stubGlobal('matchMedia', () => ({ matches: coarse, addEventListener: () => {}, removeEventListener: () => {} }));

beforeEach(() => stubPointer(false));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const newVoice = () => new JaasVoiceAdapter({ appId: 'app', getJwt: () => Promise.resolve('jwt'), displayName: 'Alice' });

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
const hasIcon = (name: string) => button().querySelector('svg')!.classList.contains(name);

describe('MuteToggle', () => {
  it('follows the effective mute and toggles away from it', () => {
    const voice = newVoice();
    const setMuted = vi.spyOn(voice, 'setMuted');
    render(<MuteToggle voice={voice} />);
    expect(button().getAttribute('aria-label')).toBe('Mute microphone');
    expect(button().getAttribute('aria-pressed')).toBe('false');
    expect(hasIcon('lucide-mic')).toBe(true);

    fireEvent.click(button());
    expect(setMuted).toHaveBeenLastCalledWith(true);
    expect(button().getAttribute('aria-label')).toBe('Unmute microphone');
    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(hasIcon('lucide-mic-off')).toBe(true);

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
      for (let i = 0; i <= MAX_MUTE_CORRECTIONS; i++) {
        api.emit('audioMuteStatusChanged', { muted: true });
      }
    });
    expect(voice.isMuted()).toBe(false);
    expect(button().getAttribute('aria-label')).toBe('Unmute microphone');
    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(hasIcon('lucide-mic-off')).toBe(true);

    const setMuted = vi.spyOn(voice, 'setMuted');
    fireEvent.click(button());
    expect(setMuted).toHaveBeenCalledWith(false);
  });

  it('stays toggleable after muting in a call and leaving it', async () => {
    const voice = newVoice();
    render(<MuteToggle voice={voice} />);
    await joinMeeting(voice);
    fireEvent.click(button());
    await act(() => voice.leaveRoom());
    expect(button().getAttribute('aria-label')).toBe('Unmute microphone');

    fireEvent.click(button());
    expect(button().getAttribute('aria-label')).toBe('Mute microphone');
    expect(button().getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(button());
    expect(button().getAttribute('aria-label')).toBe('Unmute microphone');
  });

  it('drops a mute Jitsi held once the call is left', async () => {
    const voice = newVoice();
    render(<MuteToggle voice={voice} />);
    const api = await joinMeeting(voice);
    api.executeCommand = () => {};
    act(() => {
      for (let i = 0; i <= MAX_MUTE_CORRECTIONS; i++) {
        api.emit('audioMuteStatusChanged', { muted: true });
      }
    });
    expect(button().getAttribute('aria-label')).toBe('Unmute microphone');

    await act(() => voice.leaveRoom());
    expect(button().getAttribute('aria-label')).toBe('Mute microphone');
    expect(button().getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(button());
    expect(button().getAttribute('aria-label')).toBe('Unmute microphone');
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
    expect(hasIcon('lucide-monitor-up')).toBe(true);
    fireEvent.click(button());
    expect(api.commands).toEqual(['toggleShareScreen']);

    act(() => void api.emit('screenSharingStatusChanged', { on: true }));
    expect(button().getAttribute('aria-label')).toBe('Stop sharing');
    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(hasIcon('lucide-monitor-off')).toBe(true);

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

  it('explains why it is disabled on hover, and keeps focus off on mousedown', async () => {
    render(<ShareScreenToggle voice={newVoice()} />);
    const wrapper = button().parentElement!;
    expect(fireEvent.mouseDown(wrapper)).toBe(false);
    fireEvent.pointerMove(wrapper, { pointerType: 'mouse' });
    expect((await screen.findByRole('tooltip')).textContent).toBe('Screen sharing unavailable');
  });
});

describe('JaasMeeting focus toggle', () => {
  const toggle = () => screen.queryByRole('button', { name: /screen share$/ });
  const wrapper = () => screen.getByTestId('jitsi').parentElement!;
  const isFocused = () => wrapper().style.zIndex === '40';

  async function showShare() {
    const voice = newVoice();
    render(<JaasMeeting voice={voice} />);
    const api = await joinMeeting(voice);
    act(() => void api.emit('contentSharingParticipantsChanged', { data: ['bob'] }));
    return { voice, api };
  }

  it('shrinks the share frame on a coarse pointer', async () => {
    stubPointer(true);
    await showShare();
    expect(wrapper().style.width).toBe('288px');
    expect(wrapper().style.height).toBe('162px');
  });

  it('has no toggle until a share is shown', async () => {
    const voice = newVoice();
    render(<JaasMeeting voice={voice} />);
    const api = await joinMeeting(voice);
    expect(toggle()).toBeNull();
    act(() => void api.emit('contentSharingParticipantsChanged', { data: ['bob'] }));
    expect(toggle()!.getAttribute('aria-label')).toBe('Enlarge screen share');
  });

  it('expands, releases pointer lock, and keeps the same nodes', async () => {
    Object.defineProperty(document, 'exitPointerLock', {
      value: () => {},
      configurable: true,
      writable: true,
    });
    const exitPointerLock = vi.spyOn(document, 'exitPointerLock');
    await showShare();
    const before = { wrapper: wrapper(), jitsi: screen.getByTestId('jitsi') };
    fireEvent.click(toggle()!);
    expect(exitPointerLock).toHaveBeenCalledTimes(1);
    expect(isFocused()).toBe(true);
    expect(wrapper().style.pointerEvents).toBe('auto');
    expect(toggle()!.getAttribute('aria-expanded')).toBe('true');
    expect(toggle()!.getAttribute('aria-label')).toBe('Shrink screen share');
    expect(wrapper()).toBe(before.wrapper);
    expect(screen.getByTestId('jitsi')).toBe(before.jitsi);
    expect(screen.getByTestId('jitsi').style.height).toBe('100%');
    delete (document as Partial<Document>).exitPointerLock;
  });

  it('collapses on the button, Escape and a margin click, but not a click on the share', async () => {
    await showShare();
    const expand = () => fireEvent.click(toggle()!);

    expand();
    fireEvent.mouseDown(screen.getByTestId('jitsi'));
    fireEvent.click(screen.getByTestId('jitsi'));
    expect(isFocused()).toBe(true);

    fireEvent.click(toggle()!);
    expect(isFocused()).toBe(false);

    expand();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(isFocused()).toBe(false);

    expand();
    fireEvent.mouseDown(document.querySelector('.bg-black\\/50')!);
    expect(isFocused()).toBe(false);
  });

  it('resets to collapsed when the share ends', async () => {
    const { api } = await showShare();
    fireEvent.click(toggle()!);
    act(() => void api.emit('contentSharingParticipantsChanged', { data: [] }));
    expect(toggle()).toBeNull();
    act(() => void api.emit('contentSharingParticipantsChanged', { data: ['bob'] }));
    expect(isFocused()).toBe(false);
    expect(toggle()!.getAttribute('aria-expanded')).toBe('false');
  });
});
