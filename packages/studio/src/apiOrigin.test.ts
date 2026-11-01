import { afterEach, describe, expect, it, vi } from 'vitest';

async function load(origin?: string) {
  vi.resetModules();
  vi.stubEnv('VITE_STUDIO_API_ORIGIN', origin as string);
  return import('./apiOrigin.ts');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('studioApiUrl', () => {
  it('is the bare path when unset', async () => {
    expect((await load()).studioApiUrl('/api/me')).toBe('/api/me');
  });

  it('joins the origin and drops its trailing slash', async () => {
    expect((await load('https://studio.example/')).studioApiUrl('/api/me')).toBe('https://studio.example/api/me');
  });
});

describe('studioFetch', () => {
  it('includes credentials and lets init override', async () => {
    const fetchMock = vi.fn(async () => new Response());
    vi.stubGlobal('fetch', fetchMock);
    const { studioFetch } = await load('https://studio.example');
    await studioFetch('https://studio.example/api/maps', { method: 'PUT' });
    expect(fetchMock).toHaveBeenCalledWith('https://studio.example/api/maps', { credentials: 'include', method: 'PUT' });
    await studioFetch('/x', { credentials: 'omit' });
    expect(fetchMock).toHaveBeenLastCalledWith('/x', { credentials: 'omit' });
  });
});
