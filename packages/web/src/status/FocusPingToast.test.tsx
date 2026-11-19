// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { createStore } from '@officexr/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { focusedTargetName } from './focusNotice';
import { FOCUS_TOAST_MS, FocusPingToast } from './FocusPingToast';

const storeWith = (players: Record<string, object>) => {
  const store = createStore({ selfId: 'me#t0', officeId: 'o' });
  store.setState((s) => ({ ...s, players: players as never }));
  return store;
};

describe('focusedTargetName', () => {
  it('names a focused player, by name and else by login', () => {
    const store = storeWith({ 'ada#t1': { name: 'Ada', focus: true }, 'bob#t2': { name: '', focus: true } });
    expect(focusedTargetName(store, 'ada#t1')).toBe('Ada');
    expect(focusedTargetName(store, 'bob#t2')).toBe('bob');
  });

  it('is null for a player who is not in focus mode or not present', () => {
    const store = storeWith({ 'ada#t1': { name: 'Ada', focus: false }, 'cy#t3': { name: 'Cy' } });
    expect(focusedTargetName(store, 'ada#t1')).toBeNull();
    expect(focusedTargetName(store, 'cy#t3')).toBeNull();
    expect(focusedTargetName(store, 'ghost#t9')).toBeNull();
  });
});

describe('FocusPingToast', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('tells the pinger the ping is silent, then asks to be dismissed', () => {
    const onDone = vi.fn();
    render(<FocusPingToast notice={{ name: 'Ada', n: 1 }} onDone={onDone} />);
    expect(screen.getByText('Ada is in focus mode. Your ping arrives silently.')).toBeTruthy();
    act(() => void vi.advanceTimersByTime(FOCUS_TOAST_MS - 1));
    expect(onDone).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('restarts the timer on a repeat notice', () => {
    const onDone = vi.fn();
    const { rerender } = render(<FocusPingToast notice={{ name: 'Ada', n: 1 }} onDone={onDone} />);
    act(() => void vi.advanceTimersByTime(FOCUS_TOAST_MS - 100));
    rerender(<FocusPingToast notice={{ name: 'Ada', n: 2 }} onDone={onDone} />);
    act(() => void vi.advanceTimersByTime(200));
    expect(onDone).not.toHaveBeenCalled();
  });

  it('shows nothing without a notice', () => {
    render(<FocusPingToast notice={null} onDone={() => {}} />);
    expect(screen.queryByText(/focus mode/)).toBeNull();
  });
});
