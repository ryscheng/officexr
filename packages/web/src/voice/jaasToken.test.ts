import { describe, expect, it, vi } from 'vitest';
import { fetchJaasToken, jaasTokenSource } from './jaasToken';

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('fetchJaasToken', () => {
  it('fetches the office voice token from the API', async () => {
    const fetchFn = vi.fn(() => json({ token: 't', expiresAt: 5 }));
    expect(await fetchJaasToken('o 1', fetchFn)).toEqual({ token: 't', expiresAt: 5 });
    expect(fetchFn).toHaveBeenCalledWith('/api/offices/o%201/voice-token');
  });

  it.each([401, 404, 500])('throws on %i, so voice stays off', async (status) => {
    await expect(fetchJaasToken('o', () => json({ error: 'x' }, status))).rejects.toThrow(String(status));
  });

  it('throws on a response without a token', async () => {
    await expect(fetchJaasToken('o', () => json({}))).rejects.toThrow('no token');
  });
});

describe('jaasTokenSource', () => {
  it('reuses the token until it nears expiry, then refetches once', async () => {
    let now = 0;
    const refetch = vi.fn(async () => ({ token: 'second', expiresAt: 100 * 60_000 }));
    const get = jaasTokenSource({ token: 'first', expiresAt: 60 * 60_000 }, refetch, () => now);
    expect(await get()).toBe('first');
    now = 56 * 60_000;
    expect(await Promise.all([get(), get()])).toEqual(['second', 'second']);
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('retries a failed refresh on the next call', async () => {
    const refetch = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce({ token: 'ok', expiresAt: Infinity });
    const get = jaasTokenSource({ token: 'old', expiresAt: 0 }, refetch, () => 1);
    await expect(get()).rejects.toThrow('down');
    expect(await get()).toBe('ok');
  });
});
