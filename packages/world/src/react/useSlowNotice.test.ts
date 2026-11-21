// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SLOW_LOAD_MS, useSlowNotice } from './useSlowNotice.ts';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useSlowNotice', () => {
  it('turns on after the slow threshold while still loading', () => {
    const { result } = renderHook(() => useSlowNotice(true));
    act(() => vi.advanceTimersByTime(SLOW_LOAD_MS - 1));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);
  });

  it('never turns on once loading has finished', () => {
    const { result, rerender } = renderHook(({ loading }) => useSlowNotice(loading), {
      initialProps: { loading: true },
    });
    act(() => vi.advanceTimersByTime(SLOW_LOAD_MS / 2));
    rerender({ loading: false });
    act(() => vi.advanceTimersByTime(SLOW_LOAD_MS * 2));
    expect(result.current).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears its timer on unmount', () => {
    const { unmount } = renderHook(() => useSlowNotice(true));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('useSlowNotice reset', () => {
  it('starts the wait again when the reset key changes', () => {
    const { result, rerender } = renderHook(({ key }) => useSlowNotice(true, key), { initialProps: { key: 1 } });
    act(() => vi.advanceTimersByTime(SLOW_LOAD_MS));
    expect(result.current).toBe(true);
    rerender({ key: 2 });
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(SLOW_LOAD_MS));
    expect(result.current).toBe(true);
  });
});
