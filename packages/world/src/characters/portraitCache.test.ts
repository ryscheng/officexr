import { afterEach, describe, expect, it, vi } from 'vitest';
import { cachedCharacterPortrait, knownCharacterPortrait, setPortraitStore, storeCharacterPortrait } from './portraitCache.ts';
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

  it('reports a portrait nobody has rendered as unknown', async () => {
    setPortraitStore(memoryStore());
    expect(await knownCharacterPortrait('/models/characters/Never.glb')).toBeNull();
  });
});
