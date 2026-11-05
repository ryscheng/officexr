import { afterEach, describe, expect, it } from 'vitest';
import {
  bakedLayoutAssetUrl,
  fetchSoundCatalog,
  modelUrl,
  setAssetBaseUrl,
  soundAssetUrl,
  soundCatalogUrl,
} from './asset-url.ts';

afterEach(() => setAssetBaseUrl(null));

describe('asset-url', () => {
  it('leaves every url unchanged when no base is set', () => {
    expect(modelUrl('/models/blocks/stone.gltf')).toBe('/models/blocks/stone.gltf');
    expect(bakedLayoutAssetUrl('hq')).toBe('/api/baked-layouts/hq');
    expect(soundAssetUrl('a b')).toBe('/api/sounds/a%20b.mp3');
    expect(soundCatalogUrl()).toBe('/api/sounds/');
  });

  it.each(['https://cdn.example.com', 'https://cdn.example.com/'])('maps onto base %s', (base) => {
    setAssetBaseUrl(base);
    expect(modelUrl('/models/characters/Mage.glb')).toBe('https://cdn.example.com/models/characters/Mage.glb');
    expect(bakedLayoutAssetUrl('my room/1')).toBe('https://cdn.example.com/baked-layouts/my%20room%2F1.glb');
    expect(soundAssetUrl('a b')).toBe('https://cdn.example.com/sounds/a%20b.mp3');
    expect(soundCatalogUrl()).toBe('https://cdn.example.com/sounds/index.json');
  });

  it('passes non-models paths through', () => {
    setAssetBaseUrl('https://cdn.example.com');
    expect(modelUrl('/api/world-object-kinds')).toBe('/api/world-object-kinds');
    expect(modelUrl('https://other.example.com/models/a.glb')).toBe('https://other.example.com/models/a.glb');
  });

  it('treats an empty base as unset', () => {
    setAssetBaseUrl('');
    expect(modelUrl('/models/a.glb')).toBe('/models/a.glb');
  });
});

describe('fetchSoundCatalog', () => {
  const respond = (body: unknown) => (async () => ({ json: async () => body })) as unknown as typeof fetch;

  it('returns a valid catalog', async () => {
    const catalog = { sounds: [{ name: 'ping', size: 3, updatedAt: 1 }] };
    expect(await fetchSoundCatalog('/x', respond(catalog))).toEqual(catalog);
  });

  it('returns an empty catalog for a malformed body or network failure', async () => {
    expect(await fetchSoundCatalog('/x', respond({ sounds: [{ name: 1 }] }))).toEqual({ sounds: [] });
    expect(await fetchSoundCatalog('/x', (async () => { throw new Error('down'); }) as typeof fetch)).toEqual({ sounds: [] });
  });
});
