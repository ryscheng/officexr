import { describe, expect, it, vi } from 'vitest';
import { fetchRealtimeToken } from './realtimeToken';

const respond = (status: number, body: unknown = {}) =>
  vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response) as unknown as typeof fetch;

describe('fetchRealtimeToken', () => {
  it('resolves the token on 200', async () => {
    const fetchFn = respond(200, { token: 'a.b' });
    expect(await fetchRealtimeToken(fetchFn)).toBe('a.b');
    expect(fetchFn).toHaveBeenCalledWith('/api/realtime-token');
  });

  it('resolves undefined on 404', async () => {
    expect(await fetchRealtimeToken(respond(404))).toBeUndefined();
  });

  it.each([401, 500])('rejects on %i', async (status) => {
    await expect(fetchRealtimeToken(respond(status))).rejects.toThrow(String(status));
  });
});
