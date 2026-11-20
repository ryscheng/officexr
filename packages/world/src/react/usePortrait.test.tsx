// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePortrait } from './usePortrait.ts';

const stub = (matches: (query: string) => boolean) =>
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: matches(query), addEventListener: () => {}, removeEventListener: () => {} }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('usePortrait', () => {
  it('is true when the viewport is taller than wide', () => {
    stub((q) => q === '(orientation: portrait)');
    expect(renderHook(() => usePortrait()).result.current).toBe(true);
  });

  it('stays true when a keyboard makes the viewport wide but the screen is still upright', () => {
    stub((q) => q.includes('aspect-ratio'));
    expect(renderHook(() => usePortrait()).result.current).toBe(true);
  });

  it('is false for a landscape viewport on a landscape screen', () => {
    stub(() => false);
    expect(renderHook(() => usePortrait()).result.current).toBe(false);
  });
});
