import { describe, expect, it, vi } from 'vitest';
import { createHttpMissionsClient, MissionsRequestError, MissionsUnsupportedError, newMissionError } from './missionsApi';

const wire = {
  id: 'm1',
  officeId: 'o 1',
  source: 'mine',
  ownerLogin: 'me',
  title: 'Prepare the demo',
  steps: [],
  place: null,
  dueAt: null,
  personLogin: null,
  shared: false,
  done: false,
  createdAt: '2026-11-20T08:00:00.000Z',
  updatedAt: '2026-11-20T08:00:00.000Z',
};

const reply = (status: number, body?: unknown) =>
  vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status }));

describe('createHttpMissionsClient', () => {
  it('lists the office missions from the contract route', async () => {
    const fetchFn = reply(200, { missions: [wire] });
    const list = await createHttpMissionsClient(fetchFn).list('o 1');
    expect(fetchFn).toHaveBeenCalledWith('/api/offices/o%201/missions');
    expect(list.map((m) => m.title)).toEqual(['Prepare the demo']);
  });

  it('posts a new mission as JSON and returns the stored one', async () => {
    const fetchFn = reply(201, { mission: wire });
    const mission = await createHttpMissionsClient(fetchFn).create('o 1', { title: 'Prepare the demo' });
    const [path, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe('/api/offices/o%201/missions');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ title: 'Prepare the demo' });
    expect(mission.id).toBe('m1');
  });

  it('patches and deletes by id', async () => {
    const patch = reply(200, { mission: { ...wire, done: true } });
    expect((await createHttpMissionsClient(patch).update('o', 'm 1', { done: true })).done).toBe(true);
    expect((patch.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe('/api/offices/o/missions/m%201');
    const remove = reply(204);
    await createHttpMissionsClient(remove).remove('o', 'm1');
    expect((remove.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe('DELETE');
  });

  it('reports a 404 on list as an unsupported server', async () => {
    await expect(createHttpMissionsClient(reply(404)).list('o')).rejects.toBeInstanceOf(MissionsUnsupportedError);
  });

  it('reports a 404 on create, patch and delete as a missing mission, not an old server', async () => {
    const client = createHttpMissionsClient(reply(404));
    for (const call of [() => client.create('o', { title: 'x' }), () => client.update('o', 'm', {}), () => client.remove('o', 'm')]) {
      const err = await call().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(MissionsRequestError);
      expect((err as MissionsRequestError).status).toBe(404);
    }
  });

  it('words the limit and permission refusals', async () => {
    const limit = await createHttpMissionsClient(reply(409)).create('o', { title: 'x' }).catch((e: Error) => e);
    expect((limit as Error).message).toBe('Too many open missions');
    const owner = await createHttpMissionsClient(reply(403)).update('o', 'm', {}).catch((e: Error) => e);
    expect((owner as Error).message).toBe('Only the owner can change this mission');
  });

  it('checks a title has visible text before sending', () => {
    expect(newMissionError({ title: 'Prepare' })).toBeNull();
    expect(newMissionError({ title: '​' })).toBe('Title needs visible text');
    expect(newMissionError({ title: '   ' })).toBe('Title needs visible text');
  });

  it('fails with a plain error on another status', async () => {
    const error = await createHttpMissionsClient(reply(500)).list('o').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(MissionsUnsupportedError);
  });
});
