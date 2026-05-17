import { describe, it, expect, vi } from 'vitest';
import { createCatalogService } from '../catalog-service.ts';
import type {
  WorldObjectKind,
  WorldObjectKindCatalogV1,
} from '../../scenes/world-object-kinds-schema.ts';

function makeKind(id: string, label: string = id): WorldObjectKind {
  return {
    id,
    label,
    gltfPath: `/${id}.glb`,
    swatch: '#fff',
    walkable: false,
    scale: 1,
    tint: null,
    opacity: 1,
    roughness: null,
    metalness: null,
    emissive: null,
    emissiveIntensity: 0,
    category: 'block',
    tilingAxes: { x: true, y: true, z: true },
    gravity: false,
    optimization: 'none',
  };
}

function makeCatalog(kinds: WorldObjectKind[]): WorldObjectKindCatalogV1 {
  return { schemaVersion: 1, updatedAt: 0, kinds };
}

describe('CatalogService', () => {
  it('exposes the default catalog before bootstrap completes', () => {
    const def = makeCatalog([makeKind('a')]);
    const svc = createCatalogService({
      defaultCatalog: def,
      apiPath: '',
    });
    expect(svc.listKinds().map((k) => k.id)).toEqual(['a']);
    expect(svc.getKind('a')?.id).toBe('a');
  });

  it('replaces the catalog after a successful bootstrap fetch', async () => {
    const def = makeCatalog([makeKind('a')]);
    const upstream = makeCatalog([makeKind('a'), makeKind('b')]);
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify(upstream), { status: 200 });
    });
    const svc = createCatalogService({
      defaultCatalog: def,
      apiPath: '/api/world-object-kinds',
      fetcher,
    });
    await svc.ready();
    expect(svc.listKinds().map((k) => k.id)).toEqual(['a', 'b']);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('falls back to the default when the fetch fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const def = makeCatalog([makeKind('fallback')]);
    const svc = createCatalogService({
      defaultCatalog: def,
      apiPath: '/api/world-object-kinds',
      fetcher: async () => new Response('boom', { status: 500 }),
    });
    await svc.ready();
    expect(svc.listKinds().map((k) => k.id)).toEqual(['fallback']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('subscribers fire on replaceCatalog and patchKind', async () => {
    const def = makeCatalog([makeKind('a')]);
    const svc = createCatalogService({ defaultCatalog: def, apiPath: '' });
    const listener = vi.fn();
    svc.subscribe(listener);

    svc.replaceCatalog(makeCatalog([makeKind('a'), makeKind('b')]));
    expect(listener).toHaveBeenCalledTimes(1);

    svc.patchKind('a', { label: 'A!' });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(svc.getKind('a')?.label).toBe('A!');
  });

  it('ready() resolves immediately when apiPath is empty', async () => {
    const def = makeCatalog([makeKind('a')]);
    const svc = createCatalogService({ defaultCatalog: def, apiPath: '' });
    // Should not throw and should resolve quickly.
    await expect(Promise.race([
      svc.ready(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 100)),
    ])).resolves.toBeUndefined();
  });
});
