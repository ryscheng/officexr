// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

async function load(origin?: string) {
  vi.resetModules();
  vi.stubEnv('VITE_API_ORIGIN', origin as string);
  return import('./apiOrigin');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('apiUrl', () => {
  it('is the bare path when unset', async () => {
    expect((await load()).apiUrl('/api/me')).toBe('/api/me');
  });

  it('joins the origin and drops its trailing slash', async () => {
    expect((await load('https://api.example.com/')).apiUrl('/api/me')).toBe('https://api.example.com/api/me');
  });
});

describe('apiFetch', () => {
  it('includes credentials and lets init override', async () => {
    const fetchMock = vi.fn(async () => new Response());
    vi.stubGlobal('fetch', fetchMock);
    const { apiFetch } = await load('https://api.example.com');
    await apiFetch('/api/offices', { method: 'POST' });
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/api/offices', { credentials: 'include', method: 'POST' });
    await apiFetch('/api/me', { credentials: 'omit' });
    expect(fetchMock).toHaveBeenLastCalledWith('https://api.example.com/api/me', { credentials: 'omit' });
  });
});

describe('apiFetch with a preview token', () => {
  afterEach(() => {
    window.sessionStorage.clear();
  });

  it('sends it as a bearer, keeping the caller\'s headers', async () => {
    const payload = btoa(JSON.stringify({ exp: Date.now() / 1000 + 600 })).replace(/=+$/, '');
    const token = `h.${payload}.s`;
    window.sessionStorage.setItem('officexr.previewToken', token);
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response());
    vi.stubGlobal('fetch', fetchMock);
    const { apiFetch } = await load('https://api.example.com');
    await apiFetch('/api/offices', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const init = fetchMock.mock.calls[0][1]!;
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${token}`);
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
  });
});

describe('wsUrl', () => {
  it('follows the page origin when unset', async () => {
    vi.stubGlobal('location', { origin: 'https://app.example.com' });
    expect((await load()).wsUrl()).toBe('wss://app.example.com/ws');
  });

  it.each([
    ['https://api.example.com', 'wss://api.example.com/ws'],
    ['http://localhost:4173', 'ws://localhost:4173/ws'],
  ])('uses the API origin %s', async (origin, expected) => {
    expect((await load(origin)).wsUrl()).toBe(expected);
  });
});

describe('signInHref', () => {
  const at = { pathname: '/room/a b', search: '?login_error=x&k=1' };

  it('keeps next relative when unset', async () => {
    await load();
    const { signInHref } = await import('./SignIn');
    expect(signInHref(at)).toBe(`/auth/google?next=${encodeURIComponent('/room/a b?k=1')}`);
  });

  it('makes next absolute against the SPA origin when set', async () => {
    await load('https://api.example.com');
    const { signInHref } = await import('./SignIn');
    expect(signInHref(at)).toBe(
      `https://api.example.com/auth/google?next=${encodeURIComponent(`${window.location.origin}/room/a b?k=1`)}`,
    );
  });
});
