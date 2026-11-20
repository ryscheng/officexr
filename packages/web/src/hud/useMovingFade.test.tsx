// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FADE_AFTER_MS, FADE_BACK_MS, selectSelfMoving, useMovingFade } from './useMovingFade';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe('useMovingFade', () => {
  it('fades only after the avatar has moved for a while, and returns shortly after it stops', () => {
    const { result, rerender } = renderHook(({ moving }) => useMovingFade(moving), { initialProps: { moving: false } });
    rerender({ moving: true });
    advance(FADE_AFTER_MS - 1);
    expect(result.current).toBe(false);
    advance(1);
    expect(result.current).toBe(true);
    rerender({ moving: false });
    advance(FADE_BACK_MS - 1);
    expect(result.current).toBe(true);
    advance(1);
    expect(result.current).toBe(false);
  });

  it('does not fade for a short walk', () => {
    const { result, rerender } = renderHook(({ moving }) => useMovingFade(moving), { initialProps: { moving: false } });
    rerender({ moving: true });
    advance(FADE_AFTER_MS - 200);
    rerender({ moving: false });
    advance(FADE_AFTER_MS);
    expect(result.current).toBe(false);
  });

  it('never fades when disabled', () => {
    const { result } = renderHook(() => useMovingFade(true, false));
    advance(FADE_AFTER_MS * 2);
    expect(result.current).toBe(false);
  });
});

describe('selectSelfMoving', () => {
  const state = (vel: { x: number; z: number } | undefined) =>
    ({ selfId: 'me', players: { me: vel && { vel: { x: vel.x, y: 0, z: vel.z } } } }) as never;

  it('is true above a small speed and false at rest or without a self player', () => {
    expect(selectSelfMoving(state({ x: 0, z: 2 }))).toBe(true);
    expect(selectSelfMoving(state({ x: 0.02, z: 0.02 }))).toBe(false);
    expect(selectSelfMoving(state(undefined))).toBe(false);
  });
});
