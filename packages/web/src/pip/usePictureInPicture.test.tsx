// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createActions, createBus, createStore, type Store } from '@officexr/sdk';
import { createViewYaw, NavGridProvider, ViewYawProvider } from '@officexr/world/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomMenu } from '../room/RoomMenu';
import { MuteToggle } from '../voice/JaasMeeting';
import { JaasVoiceAdapter } from '../voice/JaasVoiceAdapter';
import type { PipMediaSession } from './documentPictureInPicture';
import { PipContents } from './PipContents';
import { PopOutMenuItem } from './PopOutMenuItem';
import { usePictureInPicture, type PictureInPictureDeps } from './usePictureInPicture';

const realMatchMedia = window.matchMedia;

beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: query === '(pointer: coarse)',
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  document.querySelectorAll('iframe').forEach((frame) => frame.remove());
  window.matchMedia = realMatchMedia;
});

/** Stands in for the PiP window: an iframe's document, closed with the `pagehide` the browser sends. */
class FakePipWindow extends EventTarget {
  closed = false;
  constructor(readonly document: Document) {
    super();
  }
  close() {
    if (!this.closed) {
      this.closed = true;
      this.dispatchEvent(new Event('pagehide'));
    }
  }
}

function fakeApi() {
  const windows: FakePipWindow[] = [];
  const api = {
    window: null as Window | null,
    windows,
    requestWindow: async (): Promise<Window> => {
      const frame = document.createElement('iframe');
      document.body.append(frame);
      const win = new FakePipWindow(frame.contentDocument!);
      win.addEventListener('pagehide', () => {
        api.window = null;
      });
      windows.push(win);
      api.window = win as unknown as Window;
      return win as unknown as Window;
    },
  };
  return api;
}

function fakeMediaSession() {
  const handlers = new Map<string, (() => void) | null>();
  const session: PipMediaSession & { handlers: typeof handlers } = {
    handlers,
    setActionHandler: (action, handler) => {
      handlers.set(action, handler);
    },
  };
  return session;
}

function fakeDocument() {
  const doc = document.implementation.createHTMLDocument('room');
  let visibility: DocumentVisibilityState = 'visible';
  Object.defineProperty(doc, 'visibilityState', { get: () => visibility });
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://office.example/assets/index.css';
  const style = doc.createElement('style');
  style.textContent = '.room { color: white }';
  doc.head.append(link, style);
  return {
    doc,
    setVisibility: (next: DocumentVisibilityState) => {
      visibility = next;
      act(() => void doc.dispatchEvent(new Event('visibilitychange')));
    },
  };
}

function Room({ deps, store, voice }: { deps: PictureInPictureDeps; store: Store; voice: JaasVoiceAdapter }) {
  const pip = usePictureInPicture(deps);
  return (
    <NavGridProvider value={null}>
      <ViewYawProvider viewYaw={createViewYaw()}>
        <RoomMenu>
          <PopOutMenuItem pip={pip} />
        </RoomMenu>
        <MuteToggle voice={voice} />
        {pip.pipWindow && <PipContents pipWindow={pip.pipWindow} store={store} voice={voice} />}
      </ViewYawProvider>
    </NavGridProvider>
  );
}

function setup({ api = fakeApi() as ReturnType<typeof fakeApi> | null } = {}) {
  const mediaSession = fakeMediaSession();
  const { doc, setVisibility } = fakeDocument();
  const store = createStore({ selfId: 'me', officeId: 'o' });
  const actions = createActions(store, createBus());
  actions.upsertPlayer({ id: 'me', name: 'Me', pos: { x: 0, y: 0, z: 0 } });
  actions.upsertPlayer({ id: 'ann', name: 'Ann', pos: { x: 0, y: 0, z: -5 } });
  const voice = new JaasVoiceAdapter({ appId: 'app', jwt: Promise.resolve('jwt'), displayName: 'Me' });
  const { unmount } = render(<Room deps={{ api, mediaSession, doc }} store={store} voice={voice} />);
  const enterPip = async (times = 1) => {
    await act(async () => {
      for (let i = 0; i < times; i++) {
        mediaSession.handlers.get('enterpictureinpicture')?.();
      }
    });
  };
  const popOut = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Pop out' })));
  };
  const windows = api?.windows ?? [];
  const pipBody = () => within(windows[windows.length - 1].document.body);
  return { api, mediaSession, voice, setVisibility, enterPip, popOut, windows, pipBody, unmount };
}

describe('usePictureInPicture', () => {
  it('offers nothing without the API', () => {
    const { mediaSession } = setup({ api: null });
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.queryByRole('button', { name: 'Pop out' })).toBeNull();
    expect(mediaSession.handlers.size).toBe(0);
  });

  it('opens one window when the tab is hidden and closes it on return', async () => {
    const { enterPip, setVisibility, windows, pipBody } = setup();
    setVisibility('hidden');
    await enterPip(2);
    await enterPip();
    expect(windows).toHaveLength(1);
    expect(pipBody().getByRole('group', { name: 'Map' })).toBeTruthy();

    setVisibility('visible');
    expect(windows[0].closed).toBe(true);
    expect(pipBody().queryByRole('group', { name: 'Map' })).toBeNull();
  });

  it('keeps a popped-out window open across tab switches', async () => {
    const { popOut, setVisibility, windows } = setup();
    await popOut();
    expect(windows).toHaveLength(1);
    setVisibility('hidden');
    setVisibility('visible');
    expect(windows[0].closed).toBe(false);
  });

  it('shows the room-styled minimap and a mute button that agrees with the room', async () => {
    const { popOut, voice, windows, pipBody } = setup();
    const setMuted = vi.spyOn(voice, 'setMuted');
    await popOut();
    const head = windows[0].document.head;
    expect(head.querySelector('link[rel="stylesheet"]')?.getAttribute('href')).toBe('https://office.example/assets/index.css');
    expect(head.querySelector('style')?.textContent).toBe('.room { color: white }');

    expect(pipBody().getByRole('group', { name: 'Map' })).toBeTruthy();
    expect(pipBody().getByRole('img', { name: /^Ann, / })).toBeTruthy();
    expect(pipBody().queryByRole('button', { name: /map/ })).toBeNull();

    const pipMute = () => pipBody().getByRole('button', { name: /mute microphone/i });
    const roomMute = () => screen.getByRole('button', { name: /mute microphone/i });
    expect(pipMute().getAttribute('aria-label')).toBe('Mute microphone');
    fireEvent.click(pipMute());
    expect(setMuted).toHaveBeenLastCalledWith(true);
    expect(pipMute().getAttribute('aria-pressed')).toBe('true');
    expect(roomMute().getAttribute('aria-pressed')).toBe('true');
    act(() => voice.setMuted(false));
    expect(pipMute().getAttribute('aria-label')).toBe('Mute microphone');

    act(() => pipMute().focus());
    expect(pipBody().getByRole('tooltip').textContent).toBe('Mute microphone');
    expect(screen.queryByRole('tooltip')).toBeNull();
    // The trigger is the button's wrapper.
    fireEvent.pointerLeave(pipMute().parentElement!);
    expect(pipBody().queryByRole('tooltip')).toBeNull();
  });

  it('closes a window that arrives after the tab was shown again', async () => {
    const { mediaSession, setVisibility, windows, pipBody } = setup();
    setVisibility('hidden');
    mediaSession.handlers.get('enterpictureinpicture')!();
    setVisibility('visible');
    await act(async () => {});
    expect(windows).toHaveLength(1);
    expect(windows[0].closed).toBe(true);
    expect(pipBody().queryByRole('group', { name: 'Map' })).toBeNull();
  });

  it('hides Pop out while a window is open', async () => {
    const { popOut } = setup();
    await popOut();
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.queryByRole('button', { name: 'Pop out' })).toBeNull();
  });

  it('unmounts the contents when the window is closed, and can open again', async () => {
    const { popOut, windows, pipBody } = setup();
    await popOut();
    act(() => windows[0].close());
    expect(pipBody().queryByRole('group', { name: 'Map' })).toBeNull();
    await popOut();
    expect(windows).toHaveLength(2);
    expect(pipBody().getByRole('group', { name: 'Map' })).toBeTruthy();
  });

  it('closes the window and releases the action handler when the room unmounts', async () => {
    const { popOut, mediaSession, windows, unmount } = setup();
    await popOut();
    unmount();
    expect(windows[0].closed).toBe(true);
    expect(mediaSession.handlers.get('enterpictureinpicture')).toBeNull();
  });

  it('closes a window that arrives after the room unmounted', async () => {
    const { mediaSession, windows, unmount } = setup();
    mediaSession.handlers.get('enterpictureinpicture')!();
    unmount();
    await act(async () => {});
    expect(windows).toHaveLength(1);
    expect(windows[0].closed).toBe(true);
  });

  it('still offers Pop out where the media session rejects the action', () => {
    const throwing: PipMediaSession = {
      setActionHandler: () => {
        throw new TypeError('unknown action');
      },
    };
    render(<PopOutHarness deps={{ api: fakeApi(), mediaSession: throwing }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.getByRole('button', { name: 'Pop out' })).toBeTruthy();
  });
});

function PopOutHarness({ deps }: { deps: PictureInPictureDeps }) {
  const pip = usePictureInPicture(deps);
  return (
    <RoomMenu>
      <PopOutMenuItem pip={pip} />
    </RoomMenu>
  );
}
