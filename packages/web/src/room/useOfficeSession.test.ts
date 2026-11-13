// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { startOfficeSync } from '@officexr/core-refactor';
import { useOfficeSession } from './useOfficeSession';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete window.__OFFICEXR_CONFIG__;
});

const readyStart = vi.fn<typeof startOfficeSync>(
  async ({ local }) => ({ sync: {}, handshake: {}, stop: vi.fn(), local }) as unknown as Awaited<ReturnType<typeof startOfficeSync>>,
);

/** Serves the voice token route with `voice`, and an empty character for everything else. */
function stubApi(voice: Response) {
  const fetchFn = vi.fn((url: string) =>
    Promise.resolve(url.endsWith('/voice-token') ? voice.clone() : new Response(JSON.stringify({ characterId: null }))),
  );
  vi.stubGlobal('fetch', fetchFn);
  return fetchFn;
}

describe('useOfficeSession', () => {
  it('starts the realtime sync with the self player held', async () => {
    const start = vi.fn<typeof startOfficeSync>(() => new Promise(() => {}));
    renderHook(() => useOfficeSession('o1', { login: 'a@example.com', name: 'A' }, 'p1', true, '3d', start));

    await waitFor(() => expect(start).toHaveBeenCalledOnce());
    expect(start.mock.calls[0][0]).toMatchObject({ holdSelf: true });
  });

  it('announces the view mode with the avatar at join', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify({ characterId: null }))));
    const start = vi.fn<typeof startOfficeSync>(async ({ local }) => ({ sync: {}, handshake: {}, stop: vi.fn(), local }) as unknown as Awaited<ReturnType<typeof startOfficeSync>>);
    const { result } = renderHook(() =>
      useOfficeSession('o1', { login: 'a@example.com', name: 'A' }, 'p1', true, '2d', start),
    );
    await waitFor(() => expect(result.current.type).toBe('ready'));
    if (result.current.type === 'ready') {
      expect(result.current.local.store.getState().players.p1?.avatar?.viewMode).toBe('2d');
    }
  });

  it('turns voice on with the server-minted token when /config.js has an app id', async () => {
    window.__OFFICEXR_CONFIG__ = { VITE_JAAS_APP_ID: 'vpaas-magic-cookie-x' };
    const fetchFn = stubApi(new Response(JSON.stringify({ token: 'server-jwt', expiresAt: Date.now() + 3_600_000 })));
    const { result } = renderHook(() => useOfficeSession('o1', { login: 'a@example.com', name: 'A' }, 'p1', true, '3d', readyStart));
    await waitFor(() => expect(result.current.type).toBe('ready'));
    if (result.current.type !== 'ready') {
      return;
    }
    expect(result.current.voice?.options).toMatchObject({ appId: 'vpaas-magic-cookie-x', displayName: 'A' });
    expect(await result.current.voice?.options.getJwt()).toBe('server-jwt');
    expect(fetchFn).toHaveBeenCalledWith('/api/offices/o1/voice-token', expect.objectContaining({ credentials: 'include' }));
  });

  it('keeps voice off when the server mints no token', async () => {
    window.__OFFICEXR_CONFIG__ = { VITE_JAAS_APP_ID: 'vpaas-magic-cookie-x' };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubApi(new Response(JSON.stringify({ error: 'Voice is not enabled' }), { status: 404 }));
    const { result } = renderHook(() => useOfficeSession('o1', { login: 'a@example.com', name: 'A' }, 'p1', true, '3d', readyStart));
    await waitFor(() => expect(result.current.type).toBe('ready'));
    expect(result.current.type === 'ready' && result.current.voice).toBeNull();
    warn.mockRestore();
  });

  it('keeps voice off without an app id, without asking the server', async () => {
    const fetchFn = stubApi(new Response('{}'));
    const { result } = renderHook(() => useOfficeSession('o1', { login: 'a@example.com', name: 'A' }, 'p1', true, '3d', readyStart));
    await waitFor(() => expect(result.current.type).toBe('ready'));
    expect(result.current.type === 'ready' && result.current.voice).toBeNull();
    expect(fetchFn.mock.calls.some(([url]) => url.endsWith('/voice-token'))).toBe(false);
  });
});
