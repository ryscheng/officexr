// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoldStorage } from './foldPrefs';
import { AUTO_HIDE_MS, unreadCount, useChatVisibility } from './useChatVisibility';

const memory = (): FoldStorage => {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const setup = (options: { defaultFolded?: boolean; peekMs?: number } = {}) => {
  const storage = memory();
  const view = renderHook(({ count }) => useChatVisibility(count, { ...options, storage }), { initialProps: { count: 0 } });
  let count = 0;
  const next = () => view.rerender({ count: ++count });
  return { view, next, storage };
};

describe('useChatVisibility', () => {
  it('peeks on a new message, then hides after the peek time', () => {
    const { view, next } = setup();
    next();
    expect(view.result.current.mode).toBe('peek');
    act(() => void vi.advanceTimersByTime(AUTO_HIDE_MS));
    expect(view.result.current.mode).toBe('hidden');
  });

  it('uses a shorter peek time when asked', () => {
    const { view, next } = setup({ peekMs: 5000 });
    next();
    act(() => void vi.advanceTimersByTime(5000));
    expect(view.result.current.mode).toBe('hidden');
  });

  it('does not peek while folded', () => {
    const { view, next } = setup({ defaultFolded: true });
    next();
    expect(view.result.current.mode).toBe('hidden');
    expect(view.result.current.folded).toBe(true);
  });

  it('collapse folds and hides, and later messages stay hidden', () => {
    const { view, next } = setup();
    act(() => view.result.current.compose());
    act(() => view.result.current.collapse());
    expect(view.result.current).toMatchObject({ mode: 'hidden', folded: true });
    next();
    expect(view.result.current.mode).toBe('hidden');
  });

  it('opening the chat again unfolds it, so the next message peeks', () => {
    const { view, next } = setup({ defaultFolded: true });
    act(() => view.result.current.compose());
    expect(view.result.current).toMatchObject({ mode: 'compose', folded: false });
    act(() => view.result.current.hide());
    next();
    expect(view.result.current.mode).toBe('peek');
  });

  it('keeps composing when a message arrives, and keeps the fold choice across hide', () => {
    const { view, next } = setup();
    act(() => view.result.current.compose());
    next();
    expect(view.result.current.mode).toBe('compose');
    act(() => view.result.current.collapse());
    act(() => view.result.current.hide());
    expect(view.result.current.folded).toBe(true);
  });
});

describe('unreadCount', () => {
  const chat = [
    { id: 'a', authorId: 'peer' },
    { id: 'b', authorId: 'me' },
    { id: 'c', authorId: 'peer' },
    { id: 'd', authorId: 'other' },
  ];

  it('counts messages from others after the last one read', () => {
    expect(unreadCount(chat, 'a', 'me')).toBe(2);
    expect(unreadCount(chat, 'd', 'me')).toBe(0);
  });

  it('never counts your own messages', () => {
    expect(unreadCount([{ id: 'x', authorId: 'me' }], null, 'me')).toBe(0);
  });

  it('counts everything from others when nothing was read, or the read message is gone', () => {
    expect(unreadCount(chat, null, 'me')).toBe(3);
    expect(unreadCount(chat, 'gone', 'me')).toBe(3);
  });
});
