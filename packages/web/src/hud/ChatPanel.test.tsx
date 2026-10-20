// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { createActions, createBus, createStore } from '@officexr/sdk';
import { createMultiClientHarness } from '@officexr/sdk/test-harness';
import { useWorldFocus } from '@officexr/world/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPanel } from './ChatPanel';
import { AUTO_HIDE_MS } from './useChatVisibility';

const PLACEHOLDER = 'Type a message...';
const input = () => screen.queryByPlaceholderText(PLACEHOLDER) as HTMLInputElement | null;
const pressEnter = () => act(() => void fireEvent.keyDown(window, { key: 'Enter' }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
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
});
