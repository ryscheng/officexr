// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useFold, type FoldStorage } from './foldPrefs';

afterEach(cleanup);

const memoryStorage = (): FoldStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

const throwingStorage: FoldStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

describe('useFold', () => {
  it('uses the default until the user chooses', () => {
    expect(renderHook(() => useFold('a', true, memoryStorage())).result.current.folded).toBe(true);
    expect(renderHook(() => useFold('a', false, memoryStorage())).result.current.folded).toBe(false);
  });

  it('toggles and persists the choice under its own key', () => {
    const storage = memoryStorage();
    const { result, unmount } = renderHook(() => useFold('a', false, storage));
    act(() => result.current.toggle());
    expect(result.current.folded).toBe(true);
    expect(storage.data.get('officexr:fold:a')).toBe('folded');
    unmount();
    expect(renderHook(() => useFold('a', false, storage)).result.current.folded).toBe(true);
    expect(renderHook(() => useFold('b', false, storage)).result.current.folded).toBe(false);
  });

  it('lets a saved choice beat the default', () => {
    const storage = memoryStorage();
    const first = renderHook(() => useFold('a', true, storage));
    act(() => first.result.current.setFolded(false));
    expect(renderHook(() => useFold('a', true, storage)).result.current.folded).toBe(false);
  });

  it('keeps two panels on the same key in step', () => {
    const storage = memoryStorage();
    const one = renderHook(() => useFold('a', false, storage));
    const two = renderHook(() => useFold('a', false, storage));
    act(() => one.result.current.setFolded(true));
    expect(two.result.current.folded).toBe(true);
  });

  it('still folds for the session when storage throws', () => {
    const { result } = renderHook(() => useFold('a', false, throwingStorage));
    expect(result.current.folded).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.folded).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.folded).toBe(false);
  });

  it('ignores a value it did not write', () => {
    const storage = memoryStorage();
    storage.data.set('officexr:fold:a', 'banana');
    expect(renderHook(() => useFold('a', true, storage)).result.current.folded).toBe(true);
  });
});
