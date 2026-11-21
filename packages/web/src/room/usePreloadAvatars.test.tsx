// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { createActions, createStore } from '@officexr/sdk';
import { createDefaultApi } from '@officexr/world/app';
import { ApplicationProvider } from '@officexr/world/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePreloadAvatars } from './usePreloadAvatars';

afterEach(cleanup);

const SELF = 'me#t0';

const api = createDefaultApi({ fetcher: async () => new Response(JSON.stringify({ schemaVersion: 1, updatedAt: 1, kinds: [] })) });
const wrapper = ({ children }: { children: ReactNode }) => <ApplicationProvider api={api}>{children}</ApplicationProvider>;

describe('usePreloadAvatars', () => {
  it('preloads the self player and the players already in the room, then each newcomer', () => {
    const store = createStore({ selfId: SELF, officeId: 'o' });
    const sdk = createActions(store);
    sdk.upsertPlayer({ id: SELF, avatar: { model: 'Knight' } });
    sdk.upsertPlayer({ id: 'bao#t1', avatar: { model: 'Mage' } });
    const preload = vi.fn<(urls: string[]) => void>();
    renderHook(() => usePreloadAvatars(store, SELF, preload), { wrapper });
    expect(preload).toHaveBeenCalledTimes(1);
    expect(preload.mock.calls[0][0].sort()).toEqual(['/models/characters/Knight.glb', '/models/characters/Mage.glb']);
    act(() => sdk.upsertPlayer({ id: 'eve#t2', avatar: { model: 'Ranger' } }));
    expect(preload.mock.lastCall![0]).toContain('/models/characters/Ranger.glb');
  });

  it('preloads the fallback look of a self player who has no state yet', () => {
    const store = createStore({ selfId: SELF, officeId: 'o' });
    const preload = vi.fn<(urls: string[]) => void>();
    renderHook(() => usePreloadAvatars(store, SELF, preload), { wrapper });
    expect(preload.mock.calls[0][0]).toHaveLength(1);
    expect(preload.mock.calls[0][0][0]).toMatch(/^\/models\/characters\/.+\.glb$/);
  });

  it('does nothing without a store', () => {
    const preload = vi.fn();
    renderHook(() => usePreloadAvatars(null, null, preload), { wrapper });
    expect(preload).not.toHaveBeenCalled();
  });
});
