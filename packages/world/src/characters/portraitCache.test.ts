import { afterEach, describe, expect, it, vi } from 'vitest';
import { cachedCharacterPortrait, knownCharacterPortrait, setPortraitStore, storeCharacterPortrait, supplyCharacterPortraits } from './portraitCache.ts';
import type { PortraitStore } from './portraitStore.ts';

const URL_A = '/models/characters/Custom.glb';

function memoryStore(rows: Record<string, string> = {}): PortraitStore & { rows: Record<string, string> } {
  return {
    rows,
    read: vi.fn(async (url: string) => rows[url] ?? null),
    write: vi.fn(async (url: string, image: string) => {
      rows[url] = image;
    }),
  };
}

afterEach(() => setPortraitStore(undefined));

describe('portrait cache', () => {
  it('writes a stored portrait through to the persistent store', () => {
    const store = memoryStore();
    setPortraitStore(store);
    storeCharacterPortrait('/models/characters/Fresh.glb', 'img');
    expect(cachedCharacterPortrait('/models/characters/Fresh.glb')).toBe('img');
    expect(store.rows['/models/characters/Fresh.glb']).toBe('img');
  });

  it('finds a portrait stored on an earlier visit and keeps it in memory', async () => {
    const store = memoryStore({ [URL_A]: 'old' });
    setPortraitStore(store);
    expect(await knownCharacterPortrait(URL_A)).toBe('old');
    expect(cachedCharacterPortrait(URL_A)).toBe('old');
    await knownCharacterPortrait(URL_A);
    expect(store.read).toHaveBeenCalledTimes(1);
  });

  it('still reads a PNG data URL stored before portraits became WebP', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const url = '/models/characters/Legacy.glb';
    setPortraitStore(memoryStore({ [url]: png }));
    expect(await knownCharacterPortrait(url)).toBe(png);
  });

  it('knows a catalog-supplied portrait without the store or the renderer', async () => {
    const store = memoryStore();
    setPortraitStore(store);
    supplyCharacterPortraits([{ url: '/models/p/Druid.glb', portrait: 'data:image/webp;base64,AAAA' }, { url: '/models/p/Bare.glb' }]);
    expect(await knownCharacterPortrait('/models/p/Druid.glb')).toBe('data:image/webp;base64,AAAA');
    expect(store.read).not.toHaveBeenCalled();
    expect(cachedCharacterPortrait('/models/p/Bare.glb')).toBeNull();
  });

  it('reports a portrait nobody has rendered as unknown', async () => {
    setPortraitStore(memoryStore());
    expect(await knownCharacterPortrait('/models/characters/Never.glb')).toBeNull();
  });
});
