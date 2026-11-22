// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hintShowCount, resetHintSession } from '../hintFlags';
import { HINT_DELAY_MS, HINT_GAP_MS, HINT_MIN_SEEN_MS, HINT_SHOW_MS } from './hintPlan';
import { hintConditions, useFirstRunHint, type HintSignals } from './useFirstRunHint';

const quiet: HintSignals = {
  coarse: true,
  canBuild: true,
  moving: false,
  headcount: 3,
  someoneNear: false,
  menuOpen: false,
  otherSheetOpen: false,
  peopleOpen: false,
  mapOpen: false,
  building: false,
  inCall: false,
  toastShowing: false,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
  localStorage.clear();
  resetHintSession();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const mount = (signals: Partial<HintSignals> = {}) => renderHook((props: Partial<HintSignals>) => useFirstRunHint({ ...quiet, ...props }), { initialProps: signals });

describe('hintConditions', () => {
  it('shows no hint while a toast, a sheet or build mode has the screen', () => {
    for (const busy of [{ toastShowing: true }, { otherSheetOpen: true }, { menuOpen: true }, { building: true }]) {
      const c = hintConditions({ ...quiet, someoneNear: true, ...busy });
      expect([c.people, c.move, c.alone]).toEqual([false, false, false]);
    }
  });

  it('drops the walking hints during a call', () => {
    const c = hintConditions({ ...quiet, inCall: true });
    expect([c.people, c.move, c.alone]).toEqual([false, false, false]);
  });

  it('offers the build hint only on desktop with the menu open', () => {
    expect(hintConditions({ ...quiet, coarse: false, menuOpen: true }).build).toBe(true);
    expect(hintConditions({ ...quiet, coarse: true, menuOpen: true }).build).toBe(false);
    expect(hintConditions({ ...quiet, coarse: false, menuOpen: false }).build).toBe(false);
  });

  it('says alone only when People shows one and no one is near', () => {
    expect(hintConditions({ ...quiet, headcount: 1 }).alone).toBe(true);
    expect(hintConditions({ ...quiet, headcount: 2 }).alone).toBe(false);
    expect(hintConditions({ ...quiet, headcount: 1, someoneNear: true }).alone).toBe(false);
  });
});

describe('useFirstRunHint', () => {
  it('shows the move hint after 10 seconds without movement, then fades it after 12', () => {
    const { result } = mount({ headcount: 1 });
    advance(HINT_DELAY_MS.move - 500);
    expect(result.current.hint).toBeNull();
    advance(1000);
    expect(result.current.hint).toBe('move');
    advance(HINT_SHOW_MS);
    expect(result.current.hint).toBeNull();
  });

  it('never shows the move hint to someone who walked', () => {
    const { rerender, result } = mount({ headcount: 1 });
    advance(3000);
    rerender({ headcount: 1, moving: true });
    rerender({ headcount: 1, moving: false });
    advance(HINT_DELAY_MS.move * 2);
    expect(result.current.hint).toBeNull();
    expect(localStorage.getItem('officexr:hint:move')).toBe('done');
  });

  it('shows one hint at a time and the next one only after a gap', () => {
    const { result } = mount();
    advance(HINT_DELAY_MS.people + 500);
    expect(result.current.hint).toBe('people');
    advance(HINT_DELAY_MS.move);
    expect(result.current.hint).toBe('people');
    advance(HINT_SHOW_MS);
    expect(result.current.hint).toBeNull();
    advance(HINT_GAP_MS - 1000);
    expect(result.current.hint).toBeNull();
    advance(2000);
    expect(result.current.hint).toBe('move');
  });

  it('ends the hint at once when the person does the action, and never shows it again', () => {
    const { result, rerender } = mount();
    advance(HINT_DELAY_MS.people + 500);
    expect(result.current.hint).toBe('people');
    rerender({ peopleOpen: true, otherSheetOpen: true });
    expect(result.current.hint).toBeNull();
    rerender({});
    advance(HINT_DELAY_MS.people * 5);
    expect(result.current.hint).not.toBe('people');
    expect(localStorage.getItem('officexr:hint:people')).toBe('done');
  });

  it('counts a showing when it ends, and stops after two visits', () => {
    const visit = () => {
      const view = mount();
      advance(HINT_DELAY_MS.people + 500);
      const shown = view.result.current.hint;
      advance(HINT_SHOW_MS + 500);
      view.unmount();
      resetHintSession();
      return shown;
    };
    expect(visit()).toBe('people');
    expect(hintShowCount('people')).toBe(1);
    expect(visit()).toBe('people');
    expect(hintShowCount('people')).toBe(2);
    expect(visit()).toBeNull();
  });

  it('does not count a hint that a toast cut short, and shows it again afterwards', () => {
    const { result, rerender } = mount();
    advance(HINT_DELAY_MS.people + 500);
    expect(result.current.hint).toBe('people');
    advance(500);
    rerender({ toastShowing: true });
    expect(result.current.hint).toBeNull();
    expect(hintShowCount('people')).toBe(0);
    rerender({ toastShowing: false });
    advance(HINT_GAP_MS + HINT_DELAY_MS.people + 1000);
    expect(result.current.hint).toBe('people');
  });

  it('counts a hint that was seen for a while before a toast cut it', () => {
    const { result, rerender } = mount();
    advance(HINT_DELAY_MS.people + 500);
    advance(HINT_MIN_SEEN_MS + 500);
    rerender({ toastShowing: true });
    expect(result.current.hint).toBeNull();
    expect(hintShowCount('people')).toBe(1);
    rerender({ toastShowing: false });
    advance(HINT_GAP_MS + HINT_DELAY_MS.people + 1000);
    expect(result.current.hint).not.toBe('people');
  });

  it('does not repeat a hint that timed out in the same visit', () => {
    const { result } = mount();
    advance(HINT_DELAY_MS.people + 500);
    advance(HINT_SHOW_MS + HINT_GAP_MS + 1000);
    expect(result.current.hint).not.toBe('people');
  });

  it('restarts the wait when a toast covers the slot', () => {
    const { result, rerender } = mount({ headcount: 1 });
    advance(HINT_DELAY_MS.move - 1000);
    rerender({ headcount: 1, toastShowing: true });
    advance(2000);
    rerender({ headcount: 1, toastShowing: false });
    advance(HINT_DELAY_MS.move - 1000);
    expect(result.current.hint).toBeNull();
    advance(1500);
    expect(result.current.hint).toBe('move');
  });

  it('works when storage throws, once per session', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = mount();
    advance(HINT_DELAY_MS.people + 500);
    expect(result.current.hint).toBe('people');
    advance(HINT_SHOW_MS + HINT_GAP_MS + 1000);
    expect(result.current.hint).toBeNull();
  });
});
