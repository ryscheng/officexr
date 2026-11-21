// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePortrait } from './usePortrait.ts';

const stub = (viewportPortrait: boolean, screenType: string | undefined) => {
  vi.stubGlobal('matchMedia', () => ({ matches: viewportPortrait, addEventListener: () => {}, removeEventListener: () => {} }));
  Object.defineProperty(window.screen, 'orientation', {
    value: screenType ? Object.assign(new EventTarget(), { type: screenType }) : undefined,
    configurable: true,
  });
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('usePortrait', () => {
  it('is true when the viewport is taller than wide', () => {
    stub(true, 'landscape-primary');
    expect(renderHook(() => usePortrait()).result.current).toBe(true);
  });

  it('stays true when a keyboard makes the viewport wide but the screen is still upright', () => {
    stub(false, 'portrait-primary');
    expect(renderHook(() => usePortrait()).result.current).toBe(true);
  });

  it('is false for a landscape viewport on a landscape screen', () => {
    stub(false, 'landscape-primary');
    expect(renderHook(() => usePortrait()).result.current).toBe(false);
  });

  it('falls back to the viewport where the screen has no orientation', () => {
    stub(false, undefined);
    expect(renderHook(() => usePortrait()).result.current).toBe(false);
  });
});
