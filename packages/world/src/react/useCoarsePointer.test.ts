// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCoarsePointer } from './useCoarsePointer.ts';

const realMatchMedia = window.matchMedia;

/** A controllable `matchMedia`: `set` flips `matches` and notifies listeners. */
function fakeMatchMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  window.matchMedia = (() => ({
    get matches() {
      return matches;
    },
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  })) as unknown as typeof window.matchMedia;
  return (next: boolean) => {
    matches = next;
    listeners.forEach((l) => l());
  };
}

afterEach(() => {
  window.matchMedia = realMatchMedia;
});

describe('useCoarsePointer', () => {
  it('reports the current match and follows later changes', () => {
    const set = fakeMatchMedia(false);
    const { result } = renderHook(() => useCoarsePointer());
    expect(result.current).toBe(false);
    act(() => set(true));
    expect(result.current).toBe(true);
    act(() => set(false));
    expect(result.current).toBe(false);
  });
});
