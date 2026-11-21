// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { createActions, createBus, createStore } from '@officexr/sdk';
import { createMultiClientHarness } from '@officexr/sdk/test-harness';
import { useWorldFocus } from '@officexr/world/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPanel } from './ChatPanel';
import { AUTO_HIDE_MS } from './useChatVisibility';

const PLACEHOLDER = 'Press Enter to chat';
const input = () => screen.queryByPlaceholderText(PLACEHOLDER) as HTMLInputElement | null;
const pressEnter = () => act(() => void fireEvent.keyDown(window, { key: 'Enter' }));

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('chat between clients', () => {
  it('shows a remote message with the name announced over the channel, without taking focus', async () => {
    const harness = createMultiClientHarness();
    const alice = await harness.add('alice', { seedSelf: false });
    const bob = await harness.add('bob');
    const focus = renderHook(() => useWorldFocus());
    render(<ChatPanel store={bob.store} actions={bob.actions} selfId="bob" />);

    act(() => {
      alice.actions.upsertPlayer({ id: 'alice', name: 'Alice' });
      alice.actions.appendChat({ id: 'm1', authorId: 'alice', text: 'hello', t: 1 });
    });

    expect(bob.store.getState().chat.map((m) => m.text)).toEqual(['hello']);
    expect(screen.getByText('Alice:')).toBeTruthy();
    expect(screen.getByText(/hello/)).toBeTruthy();
    expect(document.activeElement).not.toBe(input());
    expect(focus.result.current).toBe(true);
  });
});

describe('ChatPanel', () => {
  beforeEach(() => vi.useFakeTimers());

  const setup = () => {
    const store = createStore({ selfId: 'me', officeId: 'o' });
    const actions = createActions(store, createBus());
    const focus = renderHook(() => useWorldFocus());
    render(<ChatPanel store={store} actions={actions} selfId="me" />);
    const remote = (text: string, id = text) =>
      act(() => actions.applyRemoteChat({ id, authorId: 'peer', text, t: 1 }));
    return { store, focus, remote };
  };

  it('Enter opens the input and releases the world keyboard (focus release only; movement itself lives in the renderer)', () => {
    const { focus } = setup();
    pressEnter();
    expect(document.activeElement).toBe(input());
    expect(focus.result.current).toBe(false);
  });

  it('Enter sends, then hands the keyboard back to the world', () => {
    const { store, focus } = setup();
    pressEnter();
    fireEvent.change(input()!, { target: { value: 'hi there' } });
    fireEvent.keyDown(input()!, { key: 'Enter' });
    expect(store.getState().chat.map((m) => [m.authorId, m.text])).toEqual([['me', 'hi there']]);
    expect(input()!.value).toBe('');
    expect(focus.result.current).toBe(true);
  });

  it('the hidden chat button opens the input, and the send button sends', () => {
    const { store } = setup();
    fireEvent.click(screen.getByRole('button', { name: /chat/i }));
    expect(document.activeElement).toBe(input());
    fireEvent.change(input()!, { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(store.getState().chat.map((m) => m.text)).toEqual(['hi']);
  });

  describe('/mission', () => {
    const run = async (onMissionCommand: (title: string) => Promise<boolean>, text: string) => {
      const store = createStore({ selfId: 'me', officeId: 'o' });
      const actions = createActions(store, createBus());
      render(<ChatPanel store={store} actions={actions} selfId="me" onMissionCommand={onMissionCommand} />);
      pressEnter();
      fireEvent.change(input()!, { target: { value: text } });
      await act(async () => void fireEvent.keyDown(input()!, { key: 'Enter' }));
      return store;
    };

    it('creates a mission instead of sending the text, and shows a system line', async () => {
      const create = vi.fn(async () => true);
      const store = await run(create, '/mission Prepare the demo');
      expect(create).toHaveBeenCalledWith('Prepare the demo');
      expect(store.getState().chat.map((m) => [m.authorId, m.text])).toEqual([['Missions', 'Added mission "Prepare the demo"']]);
    });

    it('says so when the mission could not be added', async () => {
      const store = await run(async () => false, '/mission Prepare the demo');
      expect(store.getState().chat.map((m) => m.text)).toEqual(['Could not add the mission']);
    });

    it('keeps the draft when the mission could not be added, and clears it when it was', async () => {
      await run(async () => false, '/mission Prepare the demo');
      expect(input()!.value).toBe('/mission Prepare the demo');
      cleanup();
      await run(async () => true, '/mission Prepare the demo');
      expect(input()?.value ?? '').toBe('');
    });

    it('cuts the title at 140 code points without splitting a surrogate pair', async () => {
      const create = vi.fn(async () => true);
      await run(create, `/mission ${'a'.repeat(139)}😀😀`);
      const title = (create.mock.calls[0] as unknown as [string])[0];
      expect(Array.from(title)).toHaveLength(140);
      expect(title.endsWith('😀')).toBe(true);
      expect(title).not.toMatch(/[\ud800-\udbff]$/);
    });

    it('sends other text, and a bare /mission, as a normal message', async () => {
      const create = vi.fn(async () => true);
      const store = await run(create, '/mission');
      expect(create).not.toHaveBeenCalled();
      expect(store.getState().chat.map((m) => m.text)).toEqual(['/mission']);
    });
  });

  it('Escape and Enter on an empty draft close the panel and return the keyboard', () => {
    const { focus } = setup();
    pressEnter();
    fireEvent.keyDown(input()!, { key: 'Escape' });
    expect(input()).toBeNull();
    expect(focus.result.current).toBe(true);
    pressEnter();
    fireEvent.keyDown(input()!, { key: 'Enter' });
    expect(input()).toBeNull();
  });

  it('ignores Enter while an IME composition is in progress', () => {
    const { store } = setup();
    pressEnter();
    fireEvent.change(input()!, { target: { value: 'にほん' } });
    fireEvent.keyDown(input()!, { key: 'Enter', keyCode: 229 });
    fireEvent.keyDown(input()!, { key: 'Enter', isComposing: true });
    expect(store.getState().chat).toHaveLength(0);
  });

  it('a remote message peeks without focusing, and Enter then focuses the input', () => {
    const { focus, remote } = setup();
    remote('yo');
    expect(input()).not.toBeNull();
    expect(document.activeElement).not.toBe(input());
    expect(focus.result.current).toBe(true);
    pressEnter();
    expect(document.activeElement).toBe(input());
  });

  it('auto-hides after 10s, restarting on each new message', () => {
    const { remote } = setup();
    remote('a');
    act(() => void vi.advanceTimersByTime(AUTO_HIDE_MS - 1));
    remote('b');
    act(() => void vi.advanceTimersByTime(AUTO_HIDE_MS - 1));
    expect(input()).not.toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(input()).toBeNull();
  });

  it('does not auto-hide while composing', () => {
    setup();
    pressEnter();
    act(() => void vi.advanceTimersByTime(AUTO_HIDE_MS * 3));
    expect(input()).not.toBeNull();
  });

  it('clicking away keeps the draft but lets the panel hide; Enter brings the draft back', () => {
    setup();
    pressEnter();
    fireEvent.change(input()!, { target: { value: 'draft' } });
    act(() => void fireEvent.mouseDown(document.body));
    act(() => void vi.advanceTimersByTime(AUTO_HIDE_MS));
    expect(input()).toBeNull();
    pressEnter();
    expect(input()!.value).toBe('draft');
  });

  it('clears the auto-hide timer on unmount', () => {
    const { remote } = setup();
    remote('a');
    cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('renders only the last 50 messages', () => {
    const { remote } = setup();
    for (let i = 0; i < 60; i++) {
      remote(`msg-${i}`);
    }
    expect(screen.queryByText(/msg-9$/)).toBeNull();
    expect(screen.getByText(/msg-10$/)).toBeTruthy();
    expect(screen.getByText(/msg-59$/)).toBeTruthy();
  });

  describe('fold', () => {
    it('Collapse chat folds it to the chip, and a later message no longer peeks', () => {
      const { remote } = setup();
      remote('a');
      fireEvent.click(screen.getByRole('button', { name: 'Collapse chat' }));
      expect(input()).toBeNull();
      remote('b');
      expect(input()).toBeNull();
      expect(localStorage.getItem('officexr:fold:chat')).toBe('folded');
    });

    it('the chip opens the chat again, which unfolds it for the next message', () => {
      const { remote } = setup();
      pressEnter();
      fireEvent.click(screen.getByRole('button', { name: 'Collapse chat' }));
      fireEvent.click(screen.getByRole('button', { name: /chat/i }));
      expect(localStorage.getItem('officexr:fold:chat')).toBe('open');
      fireEvent.keyDown(input()!, { key: 'Escape' });
      remote('later');
      expect(input()).not.toBeNull();
    });

    it('never shows an empty log: with no messages it says so in one line', () => {
      setup();
      pressEnter();
      expect(screen.getByText('No messages yet.')).toBeTruthy();
      expect(document.querySelector('.overflow-y-auto')).toBeNull();
    });

    it('the chip shows the newest message only while something is unread', () => {
      const store = createStore({ selfId: 'me', officeId: 'o' });
      const actions = createActions(store, createBus());
      act(() => actions.applyRemoteChat({ id: '1', authorId: 'peer', text: 'hello there', t: 1 }));
      localStorage.setItem('officexr:fold:chat', 'folded');
      const view = render(<ChatPanel store={store} actions={actions} selfId="me" unread={0} />);
      expect(view.getByRole('button', { name: 'Chat' }).textContent).not.toContain('hello there');
      view.rerender(<ChatPanel store={store} actions={actions} selfId="me" unread={2} />);
      const chip = view.getByRole('button', { name: 'Chat, 2 new' });
      expect(chip.textContent).toContain('hello there');
      expect(chip.textContent).toContain('2');
    });
  });

  describe('portrait', () => {
    const setupPortrait = () => {
      const store = createStore({ selfId: 'me', officeId: 'o' });
      const actions = createActions(store, createBus());
      render(<ChatPanel store={store} actions={actions} selfId="me" portrait />);
      return { store, actions };
    };

    it('shows nothing for a peek or while hidden: the preview is the ticker, outside this panel', () => {
      const { actions } = setupPortrait();
      expect(screen.queryByRole('dialog')).toBeNull();
      act(() => actions.applyRemoteChat({ id: '1', authorId: 'peer', text: 'hi', t: 1 }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(input()).toBeNull();
    });

    it('opens as a sheet on Enter, with the input focused', () => {
      setupPortrait();
      pressEnter();
      expect(screen.getByRole('dialog', { name: 'Chat' })).toBeTruthy();
      expect(document.activeElement).toBe(input());
    });

    it('keeps the keyboard open after sending, and on an empty Enter', () => {
      const { store } = setupPortrait();
      pressEnter();
      fireEvent.change(input()!, { target: { value: 'one' } });
      fireEvent.keyDown(input()!, { key: 'Enter' });
      expect(store.getState().chat.map((m) => m.text)).toEqual(['one']);
      expect(input()!.value).toBe('');
      expect(screen.getByRole('dialog', { name: 'Chat' })).toBeTruthy();
      fireEvent.keyDown(input()!, { key: 'Enter' });
      expect(screen.getByRole('dialog', { name: 'Chat' })).toBeTruthy();
    });

    it('closes with Collapse chat and Escape', () => {
      setupPortrait();
      pressEnter();
      fireEvent.click(screen.getByRole('button', { name: 'Collapse chat' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      pressEnter();
      fireEvent.keyDown(input()!, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('sizes the sheet to the visible viewport so the keyboard cannot cover the input', () => {
      vi.stubGlobal('visualViewport', Object.assign(new EventTarget(), { height: 320, offsetTop: 0 }));
      Object.defineProperty(window, 'innerHeight', { value: 640, configurable: true });
      setupPortrait();
      pressEnter();
      const sheet = screen.getByRole('dialog', { name: 'Chat' });
      expect(sheet.style.bottom).toBe('320px');
      expect(sheet.style.height).toContain('320px');
    });
  });
});

describe('ChatPanel muted senders', () => {
  const setup = (hidden: string[]) => {
    const store = createStore({ selfId: 'me', officeId: 'o' });
    const actions = createActions(store, createBus());
    const visibility = { mode: 'compose' as const, folded: false, compose: () => {}, peek: () => {}, hide: () => {}, collapse: () => {} };
    render(<ChatPanel store={store} actions={actions} selfId="me" visibility={visibility} hiddenLogins={new Set(hidden)} />);
    return actions;
  };

  it('hides messages from muted logins in every window of theirs, and shows the rest', () => {
    const actions = setup(['ann@example.test']);
    act(() => {
      actions.applyRemoteChat({ id: 'm1', authorId: 'ann@example.test#a', text: 'from the muted one', t: 1 });
      actions.applyRemoteChat({ id: 'm2', authorId: 'bob@example.test#a', text: 'from bob', t: 2 });
    });
    expect(screen.queryByText(/from the muted one/)).toBeNull();
    expect(screen.getByText(/from bob/)).toBeTruthy();
  });

  it('shows everything when nobody is muted', () => {
    const actions = setup([]);
    act(() => actions.applyRemoteChat({ id: 'm1', authorId: 'ann@example.test#a', text: 'hi there', t: 1 }));
    expect(screen.getByText(/hi there/)).toBeTruthy();
  });
});
