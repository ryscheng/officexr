import { afterEach, describe, expect, it, vi } from 'vitest';
import { CredentialedGLTFLoader } from './BakedLayout.tsx';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CredentialedGLTFLoader', () => {
  it('requests the GLB with credentials', async () => {
    const fetchMock = vi.fn(async (_req: Request) => new Response('not a glb', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const loader = new CredentialedGLTFLoader();
    expect(loader.crossOrigin).toBe('use-credentials');

    await new Promise<void>((resolve) => loader.load('https://studio.example/api/baked-layouts/a', () => resolve(), undefined, () => resolve()));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0].credentials).toBe('include');
  });
});
