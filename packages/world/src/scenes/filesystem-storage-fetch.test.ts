import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilesystemBakedLayoutStorage } from './filesystem-baked-layout-storage.ts';
import { FilesystemCatalogStorage } from './filesystem-catalog-storage.ts';
import { FilesystemLayoutStorage } from './filesystem-layout-storage.ts';
import { FilesystemMapStorage } from './filesystem-map-storage.ts';
import { FilesystemRoomStorage } from './filesystem-room-storage.ts';
import { FilesystemWorldConstantsStorage } from './world-constants-storage.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

const basePath = 'https://studio.example/api/x';
const notFound = () => vi.fn(async () => new Response('{}', { status: 404 }));

describe('Filesystem*Storage fetch option', () => {
  it.each([
    ['map', (fetch: typeof globalThis.fetch) => new FilesystemMapStorage({ basePath, fetch }).load('a')],
    ['room', (fetch: typeof globalThis.fetch) => new FilesystemRoomStorage({ basePath, fetch }).load('a')],
    ['layout', (fetch: typeof globalThis.fetch) => new FilesystemLayoutStorage({ basePath, fetch }).load('a')],
    ['baked layout', (fetch: typeof globalThis.fetch) => new FilesystemBakedLayoutStorage({ basePath, fetch }).load('a')],
    ['catalog', (fetch: typeof globalThis.fetch) => new FilesystemCatalogStorage({ basePath, fetch }).load()],
    ['world constants', (fetch: typeof globalThis.fetch) => new FilesystemWorldConstantsStorage({ basePath, fetch }).load()],
  ])('%s storage sends its requests through the injected fetch', async (_name, load) => {
    const globalFetch = notFound();
    vi.stubGlobal('fetch', globalFetch);
    const injected = notFound();
    await expect(load(injected)).resolves.toBeNull();
    expect(injected).toHaveBeenCalledTimes(1);
    expect(String((injected.mock.calls[0] as unknown[])[0])).toMatch(/^https:\/\/studio\.example\/api\/x/);
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it('defaults to the global fetch at call time', async () => {
    const storage = new FilesystemMapStorage();
    const globalFetch = notFound();
    vi.stubGlobal('fetch', globalFetch);
    await storage.load('a');
    expect(globalFetch).toHaveBeenCalledWith('/api/maps/a', undefined);
  });
});
