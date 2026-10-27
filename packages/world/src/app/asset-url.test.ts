import { afterEach, describe, expect, it } from 'vitest';
import { bakedLayoutAssetUrl, modelUrl, setAssetBaseUrl } from './asset-url.ts';

afterEach(() => setAssetBaseUrl(null));

describe('asset-url', () => {
  it('leaves every url unchanged when no base is set', () => {
    expect(modelUrl('/models/blocks/stone.gltf')).toBe('/models/blocks/stone.gltf');
    expect(bakedLayoutAssetUrl('hq')).toBe('/api/baked-layouts/hq');
  });

  it.each(['https://cdn.example.com', 'https://cdn.example.com/'])('maps onto base %s', (base) => {
    setAssetBaseUrl(base);
    expect(modelUrl('/models/characters/Mage.glb')).toBe('https://cdn.example.com/models/characters/Mage.glb');
    expect(bakedLayoutAssetUrl('my room/1')).toBe('https://cdn.example.com/baked-layouts/my%20room%2F1.glb');
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
