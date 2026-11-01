import { afterEach, describe, expect, it, vi } from 'vitest';

async function load(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    vi.stubEnv(k, v);
  }
  return import('./realtime-config.ts');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('browserRealtimeConfig', () => {
  it('defaults ws and health to the studio API origin when set', async () => {
    const { browserRealtimeConfig } = await load({ VITE_STUDIO_API_ORIGIN: 'https://studio.example' });
    expect(browserRealtimeConfig()).toMatchObject({
      url: 'wss://studio.example/ws',
      healthUrl: 'https://studio.example/health',
    });
  });

  it('lets VITE_REALTIME_URL / VITE_HEALTH_URL override the studio API origin', async () => {
    const { browserRealtimeConfig } = await load({
      VITE_STUDIO_API_ORIGIN: 'https://studio.example',
      VITE_REALTIME_URL: 'wss://rt.example/ws',
      VITE_HEALTH_URL: 'https://rt.example/health',
    });
    expect(browserRealtimeConfig()).toMatchObject({
      url: 'wss://rt.example/ws',
      healthUrl: 'https://rt.example/health',
    });
  });
});

describe('isRealtimeServerAvailable', () => {
  it('sends credentials only to the studio API', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response());
    vi.stubGlobal('fetch', fetchMock);
    const { isRealtimeServerAvailable } = await load({ VITE_STUDIO_API_ORIGIN: 'https://studio.example' });

    await expect(isRealtimeServerAvailable('https://studio.example/health')).resolves.toBe(true);
    expect(fetchMock.mock.calls[0][1]?.credentials).toBe('include');

    await isRealtimeServerAvailable('https://rt.example/health');
    expect(fetchMock.mock.calls[1][1]?.credentials).toBeUndefined();
  });
});
