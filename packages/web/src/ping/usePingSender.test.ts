// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePingSender } from './usePingSender';

describe('usePingSender', () => {
  let t = 0;
  const clock = () => t;
  const sent: string[] = [];
  const send = (id: string) => sent.push(id);
  const advance = (ms: number) =>
    act(() => {
      t += ms;
      vi.advanceTimersByTime(ms);
    });

  beforeEach(() => {
    t = 0;
    sent.length = 0;
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('sends the first ping, drops one within 5s and sends again after', () => {
    const { result } = renderHook(() => usePingSender(send, clock));
    act(() => result.current.ping('a'));
    advance(4999);
    act(() => result.current.ping('a'));
    expect(sent).toEqual(['a']);
    advance(1);
    act(() => result.current.ping('a'));
    expect(sent).toEqual(['a', 'a']);
  });

  it('cools down per target and re-renders when the cooldown ends', () => {
    const { result } = renderHook(() => usePingSender(send, clock));
    act(() => result.current.ping('a'));
    expect(result.current.isCoolingDown('a')).toBe(true);
    expect(result.current.isCoolingDown('b')).toBe(false);
    act(() => result.current.ping('b'));
    expect(sent).toEqual(['a', 'b']);
    advance(5000);
    expect(result.current.isCoolingDown('a')).toBe(false);
  });
});
