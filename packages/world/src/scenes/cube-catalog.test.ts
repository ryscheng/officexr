import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  __resetBootstrapForTests,
  bootstrapCatalog,
  getCatalog,
  getKind,
  listKinds,
  replaceCatalog,
  resetCatalogToDefault,
  subscribeCatalog,
} from './cube-catalog.ts';
import {
  CUBE_KIND_DEFAULTS,
  validateCubeKindCatalog,
  type CubeKindCatalogV1,
} from './cube-kinds-schema.ts';

function makeCatalog(
  partial?: Partial<CubeKindCatalogV1['kinds'][number]>,
): CubeKindCatalogV1 {
  return {
    schemaVersion: 1,
    updatedAt: 1700000000000,
    kinds: [
      {
        id: 'block_alpha',
        label: 'Alpha',
        gltfPath: '/models/alpha.gltf',
        swatch: '#abcdef',
        walkable: false,
        scale: 1,
        tint: null,
        opacity: 1,
        roughness: null,
        metalness: null,
        emissive: null,
        emissiveIntensity: 0,
        category: 'block',
        ...partial,
      },
    ],
  };
}

describe('cube-catalog store', () => {
  beforeEach(() => {
    __resetBootstrapForTests();
  });

  it('starts with the bundled-default catalog hydrated', () => {
    const kinds = listKinds();
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds[0].id).toBe('colored_block_blue');
  });

  it('replaceCatalog updates the snapshot and fires subscribers', () => {
    // This is the load-bearing primitive `useCubeCatalog` is built on:
    // the React hook simply forwards `subscribeCatalog` into a
    // `useReducer` force-update. If this test passes, the hook
    // re-renders consumers on every `replaceCatalog` call.
    let fired = 0;
    const unsub = subscribeCatalog(() => {
      fired++;
    });
    replaceCatalog(makeCatalog({ id: 'block_alpha' }));
    expect(getCatalog().kinds).toHaveLength(1);
    expect(getKind('block_alpha')?.id).toBe('block_alpha');
    expect(fired).toBe(1);
    unsub();
    replaceCatalog(makeCatalog({ id: 'block_beta' }));
    expect(fired).toBe(1); // unsubscribed listener does not fire again
  });

  it('resetCatalogToDefault restores the bundled list and notifies subscribers', () => {
    replaceCatalog(makeCatalog());
    let fired = 0;
    const unsub = subscribeCatalog(() => {
      fired++;
    });
    resetCatalogToDefault();
    expect(getKind('colored_block_blue')).toBeDefined();
    expect(fired).toBe(1);
    unsub();
  });

  it('getKind returns undefined for missing ids', () => {
    expect(getKind('not-a-kind')).toBeUndefined();
  });
});

describe('cube-catalog bootstrap', () => {
  beforeEach(() => {
    __resetBootstrapForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('replaces the catalog with the /api/cube-kinds payload on success', async () => {
    const remote = makeCatalog({ id: 'remote_kind', label: 'Remote' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify(remote), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    await bootstrapCatalog();
    expect(getKind('remote_kind')?.label).toBe('Remote');
  });

  it('falls back to the bundled default when fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 })),
    );
    await bootstrapCatalog();
    // Bundled default still in place
    expect(getKind('colored_block_blue')).toBeDefined();
  });

  it('memoizes — repeat calls do not re-fetch', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(makeCatalog()), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await bootstrapCatalog();
    await bootstrapCatalog();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('validateCubeKindCatalog', () => {
  it('round-trips a fully-populated entry', () => {
    const cat = makeCatalog({
      tint: '#ff00ff',
      opacity: 0.5,
      roughness: 0.7,
      metalness: 0.3,
      emissive: '#000099',
      emissiveIntensity: 1.5,
      scale: 1.2,
      category: 'furniture',
    });
    const back = validateCubeKindCatalog(JSON.parse(JSON.stringify(cat)));
    expect(back).toEqual(cat);
  });

  it('fills missing override fields with the documented defaults', () => {
    const back = validateCubeKindCatalog({
      schemaVersion: 1,
      updatedAt: 0,
      kinds: [
        {
          id: 'k',
          label: 'K',
          gltfPath: '/k.gltf',
          swatch: '#000000',
          walkable: true,
        },
      ],
    });
    expect(back.kinds[0]).toMatchObject({
      walkable: true,
      scale: CUBE_KIND_DEFAULTS.scale,
      tint: CUBE_KIND_DEFAULTS.tint,
      opacity: CUBE_KIND_DEFAULTS.opacity,
      roughness: CUBE_KIND_DEFAULTS.roughness,
      metalness: CUBE_KIND_DEFAULTS.metalness,
      emissive: CUBE_KIND_DEFAULTS.emissive,
      emissiveIntensity: CUBE_KIND_DEFAULTS.emissiveIntensity,
      category: CUBE_KIND_DEFAULTS.category,
    });
  });

  it('rejects unknown schemaVersion', () => {
    expect(() => validateCubeKindCatalog({ schemaVersion: 99 })).toThrow(
      /schemaVersion 99/,
    );
  });

  it('rejects missing required fields per kind', () => {
    expect(() =>
      validateCubeKindCatalog({
        schemaVersion: 1,
        kinds: [{ id: '', label: 'x', gltfPath: '/x', swatch: '#000' }],
      }),
    ).toThrow(/id/);
    expect(() =>
      validateCubeKindCatalog({
        schemaVersion: 1,
        kinds: [{ id: 'x', label: '', gltfPath: '/x', swatch: '#000' }],
      }),
    ).toThrow(/label/);
  });

  it('rejects non-array kinds', () => {
    expect(() =>
      validateCubeKindCatalog({ schemaVersion: 1, kinds: 'not-an-array' }),
    ).toThrow(/kinds/);
  });

  it('coerces invalid category to the default', () => {
    const back = validateCubeKindCatalog({
      schemaVersion: 1,
      kinds: [
        {
          id: 'k',
          label: 'K',
          gltfPath: '/k.gltf',
          swatch: '#000',
          category: 'not-a-real-category',
        },
      ],
    });
    expect(back.kinds[0].category).toBe(CUBE_KIND_DEFAULTS.category);
  });
});
