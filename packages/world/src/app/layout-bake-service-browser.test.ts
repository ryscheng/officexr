import { describe, expect, it, vi } from 'vitest';
import { Document, WebIO } from '@gltf-transform/core';
import { createBrowserBakeDeps } from './layout-bake-service-browser.ts';
import type { WorldObjectKind } from '../scenes/world-object-kinds-schema.ts';
import type { CatalogService, InstanceGeometryService } from './types.ts';

const catalog = { getKind: () => null } as unknown as CatalogService;
const geometry = {} as InstanceGeometryService;
const plainKind = { id: 'a', gltfPath: '/models/a.glb' } as WorldObjectKind;

describe('createBrowserBakeDeps', () => {
  it('loads models from modelBaseUrl and publishes to basePath through the injected fetch', async () => {
    const doc = new Document();
    doc.createScene('s');
    const glb = await new WebIO().writeBinary(doc);
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'PUT' ? new Response(null, { status: 204 }) : new Response(glb),
    );
    const deps = createBrowserBakeDeps(catalog, geometry, {
      basePath: 'https://studio.example/api/baked-layouts',
      modelBaseUrl: 'https://studio.example',
      fetch,
    });

    const loaded = (await deps.gltfLoader('/models/a.glb', plainKind)) as Uint8Array;
    expect(loaded.byteLength).toBeGreaterThan(0);
    expect(fetch).toHaveBeenCalledWith('https://studio.example/models/a.glb');

    await deps.publish('lay', loaded);
    expect(fetch).toHaveBeenLastCalledWith(
      'https://studio.example/api/baked-layouts/lay',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('refuses a kind with a private model source, naming the kind', async () => {
    const deps = createBrowserBakeDeps(catalog, geometry, { fetch: vi.fn() });
    const kind = { id: 'secret_chair', gltfPath: '/models/x.glb', sourceObject: 'packs/p/x.glb' } as WorldObjectKind;
    await expect(deps.gltfLoader('/models/x.glb', kind)).rejects.toThrow(/secret_chair/);
  });
});
