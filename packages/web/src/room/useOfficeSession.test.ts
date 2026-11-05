// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { startOfficeSync } from '@officexr/core-refactor';
import { useOfficeSession } from './useOfficeSession';

afterEach(cleanup);

describe('useOfficeSession', () => {
  it('starts the realtime sync with the self player held', () => {
    const start = vi.fn<typeof startOfficeSync>(() => new Promise(() => {}));
    renderHook(() => useOfficeSession('o1', { login: 'a@example.com', name: 'A' }, 'p1', true, '3d', start));

    expect(start).toHaveBeenCalledOnce();
    expect(start.mock.calls[0][0]).toMatchObject({ holdSelf: true });
  });

  it('announces the view mode with the avatar at join', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify({ characterId: null }))));
    const start = vi.fn<typeof startOfficeSync>(async ({ local }) => ({ sync: {}, handshake: {}, stop: vi.fn(), local }) as never);
    const { result } = renderHook(() =>
      useOfficeSession('o1', { login: 'a@example.com', name: 'A' }, 'p1', true, '2d', start),
    );
    await waitFor(() => expect(result.current.type).toBe('ready'));
    if (result.current.type === 'ready') {
      expect(result.current.local.store.getState().players.p1?.avatar?.viewMode).toBe('2d');
    }
    vi.unstubAllGlobals();
  });
});
