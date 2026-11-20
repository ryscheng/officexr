// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { Mission, MissionsClient } from '@officexr/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryMissionsClient } from './inMemoryMissions';
import { MissionsRequestError } from './missionsApi';
import { useMissions } from './useMissions';

afterEach(cleanup);

const mission = (over: Partial<Mission> = {}): Mission => ({
  id: 'a',
  officeId: 'o',
  source: 'mine',
  ownerLogin: 'me',
  title: 'A',
  steps: [],
  place: null,
  dueAt: null,
  personLogin: null,
  shared: false,
  done: false,
  createdAt: '2026-11-20T08:00:00Z',
  updatedAt: '2026-11-20T08:00:00Z',
  ...over,
});

const deferred = () => {
  const pending: ((l: Mission[]) => void)[] = [];
  const client: MissionsClient = {
    list: () => new Promise((r) => pending.push(r)),
    create: async () => mission(),
    update: async (_o, id, patch) => mission({ id, ...patch }),
    remove: async () => {},
  };
  return { client, pending };
};

describe('useMissions failures and races', () => {
  it('a 404 on update drops that row and reloads, and the panel stays supported', async () => {
    const client = createInMemoryMissionsClient('me');
    const made = await client.create('o', { title: 'Gone' });
    vi.spyOn(client, 'update').mockRejectedValue(new MissionsRequestError(404, 'That mission no longer exists'));
    const { result } = renderHook(() => useMissions(client, 'o'));
    await waitFor(() => expect(result.current.missions).toHaveLength(1));
    await client.remove('o', made.id);
    await act(() => result.current.update(made.id, { done: true }));
    expect(result.current.status).toBe('ready');
    await waitFor(() => expect(result.current.missions).toEqual([]));
  });

  it('keeps the status ready after a refused action and shows why, then clears it on success', async () => {
    const client = createInMemoryMissionsClient('me');
    vi.spyOn(client, 'create').mockRejectedValueOnce(new MissionsRequestError(409, 'Too many open missions'));
    const { result } = renderHook(() => useMissions(client, 'o'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => void (await result.current.create({ title: 'One' })));
    expect(result.current.status).toBe('ready');
    expect(result.current.error).toBe('Too many open missions');
    await act(async () => void (await result.current.create({ title: 'Two' })));
    expect(result.current.error).toBeNull();
  });

  it('refuses a title without visible text before calling the server', async () => {
    const client = createInMemoryMissionsClient('me');
    const create = vi.spyOn(client, 'create');
    const { result } = renderHook(() => useMissions(client, 'o'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => void (await result.current.create({ title: '​' })));
    expect(create).not.toHaveBeenCalled();
    expect(result.current.error).toBe('Title needs visible text');
  });

  it('a list that started before an update and lands after it does not undo the update', async () => {
    const d = deferred();
    let fire: (o: string) => void = () => {};
    const { result } = renderHook(() => useMissions(d.client, 'o', (l) => ((fire = l), () => {})));
    await act(async () => d.pending[0]!([mission()]));
    act(() => fire('o'));
    await act(() => result.current.update('a', { done: true }));
    await act(async () => d.pending[1]!([mission({ done: false })]));
    expect(result.current.missions[0]?.done).toBe(true);
    await waitFor(() => expect(d.pending).toHaveLength(3));
  });

  it('a burst of changed frames costs one request in flight and one queued', async () => {
    const d = deferred();
    let fire: (o: string) => void = () => {};
    renderHook(() => useMissions(d.client, 'o', (l) => ((fire = l), () => {})));
    act(() => {
      for (let i = 0; i < 20; i++) fire('o');
    });
    expect(d.pending).toHaveLength(1);
    await act(async () => d.pending[0]!([]));
    await waitFor(() => expect(d.pending).toHaveLength(2));
    await act(async () => d.pending[1]!([]));
    expect(d.pending).toHaveLength(2);
  });
});
