// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { createActions, createBus, createStore, EMOTE_BUBBLE_MS } from '@officexr/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shouldShowBubbles, usePlayerEmote, usePlayerHandRaised } from './PlayerBubbles.tsx';
import { statusTagOf } from './PlayerNameTag.tsx';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('usePlayerEmote', () => {
  it('shows the emote that player sent for the bubble time, then clears', () => {
    const bus = createBus();
    const { result } = renderHook(() => usePlayerEmote(bus, 'ann'));
    expect(result.current).toBeNull();

    act(() => bus.emit({ kind: 'emote:received', fromId: 'ann', emote: 'party', at: 0 }));
    expect(result.current?.emote).toBe('party');

    act(() => void vi.advanceTimersByTime(EMOTE_BUBBLE_MS - 1));
    expect(result.current?.emote).toBe('party');
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toBeNull();
  });

  it('ignores other players', () => {
    const bus = createBus();
    const { result } = renderHook(() => usePlayerEmote(bus, 'ann'));
    act(() => bus.emit({ kind: 'emote:received', fromId: 'bob', emote: 'heart', at: 0 }));
    expect(result.current).toBeNull();
  });

  it('restarts the timer and the pop when the same emote repeats, and swaps to a newer emote', () => {
    const bus = createBus();
    const { result } = renderHook(() => usePlayerEmote(bus, 'ann'));
    act(() => bus.emit({ kind: 'emote:received', fromId: 'ann', emote: 'clap', at: 0 }));
    const first = result.current!.n;
    act(() => void vi.advanceTimersByTime(EMOTE_BUBBLE_MS - 100));
    act(() => bus.emit({ kind: 'emote:received', fromId: 'ann', emote: 'clap', at: 1 }));
    expect(result.current!.n).toBeGreaterThan(first);
    act(() => void vi.advanceTimersByTime(200));
    expect(result.current?.emote).toBe('clap');

    act(() => bus.emit({ kind: 'emote:received', fromId: 'ann', emote: 'laugh', at: 2 }));
    expect(result.current?.emote).toBe('laugh');
  });

  it('stops listening on unmount', () => {
    const bus = createBus();
    const { result, unmount } = renderHook(() => usePlayerEmote(bus, 'ann'));
    unmount();
    expect(() => bus.emit({ kind: 'emote:received', fromId: 'ann', emote: 'wave', at: 0 })).not.toThrow();
    expect(result.current).toBeNull();
  });
});

describe('usePlayerHandRaised', () => {
  it('follows the player hand until it is lowered or the player leaves', () => {
    const store = createStore({ selfId: 'me', officeId: 'o' });
    const actions = createActions(store, createBus());
    actions.upsertPlayer({ id: 'ann', name: 'Ann' });
    const { result } = renderHook(() => usePlayerHandRaised(store, 'ann'));
    expect(result.current).toBe(false);

    act(() => actions.applyRemoteHand('ann', true, 0));
    expect(result.current).toBe(true);
    act(() => actions.applyRemoteHand('ann', false, 1));
    expect(result.current).toBe(false);

    act(() => actions.applyRemoteHand('ann', true, 2));
    act(() => actions.removePlayer('ann'));
    expect(result.current).toBe(false);
  });
});

describe('shouldShowBubbles', () => {
  const emote = { emote: 'heart', n: 1 } as const;
  it('shows for a raised hand or a live emote', () => {
    expect(shouldShowBubbles(false, true, null)).toBe(true);
    expect(shouldShowBubbles(false, false, emote)).toBe(true);
  });
  it('hides with neither, and when paused', () => {
    expect(shouldShowBubbles(false, false, null)).toBe(false);
    expect(shouldShowBubbles(true, true, emote)).toBe(false);
  });
});

describe('statusTagOf', () => {
  it('reads the status fields with empty defaults', () => {
    expect(statusTagOf(undefined)).toEqual({ statusText: '', statusEmoji: '', focus: false });
    expect(statusTagOf({ statusText: 'Busy', statusEmoji: '🔥', focus: true })).toEqual({
      statusText: 'Busy',
      statusEmoji: '🔥',
      focus: true,
    });
    expect(statusTagOf({ statusText: null, statusEmoji: null })).toEqual({ statusText: '', statusEmoji: '', focus: false });
  });
});
