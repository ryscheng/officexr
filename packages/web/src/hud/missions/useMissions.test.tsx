// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { MissionsClient } from '@officexr/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryMissionsClient } from './inMemoryMissions';
import { MissionsUnsupportedError } from './missionsApi';
import { useMissions } from './useMissions';

afterEach(cleanup);

describe('useMissions', () => {
  it('loads the office missions', async () => {
    const client = createInMemoryMissionsClient('me');
    await client.create('o', { title: 'First' });
    const { result } = renderHook(() => useMissions(client, 'o'));
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.missions.map((m) => m.title)).toEqual(['First']);
  });

  it('adds, completes and removes a mission', async () => {
    const client = createInMemoryMissionsClient('me');
    const { result } = renderHook(() => useMissions(client, 'o'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    let id = '';
    await act(async () => {
      id = (await result.current.create({ title: 'Ship it' }))!.id;
    });
    expect(result.current.missions.map((m) => m.title)).toEqual(['Ship it']);
    await act(() => result.current.update(id, { done: true }));
    expect(result.current.missions[0]?.done).toBe(true);
    await act(() => result.current.remove(id));
    expect(result.current.missions).toEqual([]);
  });

  it('reloads when the office changed frame arrives for this office only', async () => {
    const client = createInMemoryMissionsClient('me');
    const list = vi.spyOn(client, 'list');
    let notify: (officeId: string) => void = () => {};
    const subscribe = (listener: (officeId: string) => void) => {
      notify = listener;
      return () => {};
    };
    const { result } = renderHook(() => useMissions(client, 'o', subscribe));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(list).toHaveBeenCalledTimes(1);
    await client.create('o', { title: 'Added elsewhere' });
    act(() => notify('other'));
    expect(list).toHaveBeenCalledTimes(1);
    act(() => notify('o'));
    await waitFor(() => expect(result.current.missions).toHaveLength(1));
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('is unsupported on a server without the API, and not an error', async () => {
    const client: MissionsClient = {
      list: () => Promise.reject(new MissionsUnsupportedError()),
      create: () => Promise.reject(new MissionsUnsupportedError()),
      update: () => Promise.reject(new MissionsUnsupportedError()),
      remove: () => Promise.reject(new MissionsUnsupportedError()),
    };
    const { result } = renderHook(() => useMissions(client, 'o'));
    await waitFor(() => expect(result.current.status).toBe('unsupported'));
    expect(result.current.missions).toEqual([]);
  });

  it('reports a failed load as an error', async () => {
    const client = createInMemoryMissionsClient('me');
    vi.spyOn(client, 'list').mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useMissions(client, 'o'));
    await waitFor(() => expect(result.current.status).toBe('error'));
  });

  it('tracks the current mission and drops it once done or removed', async () => {
    const client = createInMemoryMissionsClient('me');
    const { result } = renderHook(() => useMissions(client, 'o'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    let id = '';
    await act(async () => {
      id = (await result.current.create({ title: 'Go there' }))!.id;
    });
    act(() => result.current.setCurrent(id));
    expect(result.current.current?.id).toBe(id);
    await act(() => result.current.update(id, { done: true }));
    expect(result.current.current).toBeNull();
  });
});
