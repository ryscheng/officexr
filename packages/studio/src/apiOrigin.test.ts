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

describe('studioFetch with a preview token', () => {
  const exp = Date.UTC(2026, 0, 1, 0, 10) / 1000;
  const token = `h.${btoa(JSON.stringify({ exp })).replace(/=+$/, '')}.s`;

  afterEach(() => {
    vi.useRealTimers();
    window.sessionStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('captures the token from the fragment and sends it as a bearer until it expires', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 0, 1));
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response());
    vi.stubGlobal('fetch', fetchMock);
    const { studioFetch } = await load('https://studio.example');
    const { capturePreviewToken } = await import('@officexr/server/preview-token');
    window.history.replaceState(null, '', `/studio/?a=1#officexr_token=${token}`);

    capturePreviewToken();
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe('/studio/?a=1');
    await studioFetch('https://studio.example/api/me', { headers: { 'Content-Type': 'application/json' } });
    const sent = new Headers(fetchMock.mock.calls[0][1]!.headers);
    expect(sent.get('authorization')).toBe(`Bearer ${token}`);
    expect(sent.get('content-type')).toBe('application/json');

    await studioFetch('https://storage.googleapis.com/bucket/obj?sig=1', { method: 'PUT', headers: { 'x-goog-meta': '1' } });
    expect(new Headers(fetchMock.mock.calls[1][1]!.headers).get('authorization')).toBeNull();
    await studioFetch(new Request('https://studio.example/api/maps', { headers: { 'x-keep': '1' } }));
    const fromRequest = new Headers(fetchMock.mock.calls[2][1]!.headers);
    expect(fromRequest.get('authorization')).toBe(`Bearer ${token}`);
    expect(fromRequest.get('x-keep')).toBe('1');

    vi.setSystemTime(exp * 1000);
    await studioFetch('https://studio.example/api/me');
    expect(fetchMock).toHaveBeenLastCalledWith('https://studio.example/api/me', { credentials: 'include' });
  });
});
