// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { storeCharacterPortrait } from '../characters/portraitCache.ts';
import { useCharacterPortrait } from './useCharacterPortrait.ts';

const render = vi.fn<(url: string) => Promise<string>>();
vi.mock('../renderer/characterPortrait.ts', () => ({ renderCharacterPortrait: (url: string) => render(url) }));

afterEach(() => {
  cleanup();
  render.mockReset();
});

describe('useCharacterPortrait', () => {
  it('is null for no model and renders nothing', () => {
    const { result } = renderHook(() => useCharacterPortrait(undefined));
    expect(result.current).toBeNull();
    expect(render).not.toHaveBeenCalled();
  });

  it('is null until the portrait is rendered, then the image', async () => {
    render.mockResolvedValue('data:image/png;base64,AAA');
    const { result } = renderHook(() => useCharacterPortrait('/m/pending.glb'));
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe('data:image/png;base64,AAA'));
  });

  it('stays null when rendering fails', async () => {
    render.mockRejectedValue(new Error('no webgl'));
    const { result } = renderHook(() => useCharacterPortrait('/m/broken.glb'));
    await waitFor(() => expect(render).toHaveBeenCalledTimes(1));
    expect(result.current).toBeNull();
  });

  it('returns a cached portrait on the first render without rendering again', () => {
    storeCharacterPortrait('/m/cached.glb', 'data:image/png;base64,BBB');
    const { result } = renderHook(() => useCharacterPortrait('/m/cached.glb'));
    expect(result.current).toBe('data:image/png;base64,BBB');
    expect(render).not.toHaveBeenCalled();
  });

  it('does not show the previous model while the next one renders', async () => {
    render.mockImplementation(async (url) => `data:image/png;base64,${url.slice(-5)}`);
    const { result, rerender } = renderHook(({ url }) => useCharacterPortrait(url), { initialProps: { url: '/m/aaaaa' } });
    await waitFor(() => expect(result.current).toBe('data:image/png;base64,aaaaa'));
    render.mockImplementation(() => new Promise(() => undefined));
    rerender({ url: '/m/bbbbb' });
    expect(result.current).toBeNull();
  });
});
