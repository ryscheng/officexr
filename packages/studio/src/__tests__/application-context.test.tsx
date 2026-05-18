/**
 * Hook tests for `@officexr/world/react`. Live in the studio package
 * because studio has `@testing-library/react` + jsdom already wired.
 *
 * The headline regression these guard:
 *   - `useInstanceAABB` must recompute when a kind's dimensions are
 *     edited live (catalog.patchKind). The initial implementation
 *     used a memo deps list that didn't change on patches → stale
 *     AABBs. The fix subscribes via `useSyncExternalStore` and uses
 *     the catalog snapshot reference as a memo key.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  ApplicationProvider,
  useApplication,
  useCatalog,
  useInstanceAABB,
  useKind,
} from '@officexr/world/react';
import {
  createCatalogService,
  createInstanceGeometry,
  createRoomService,
  createBakeService,
  createSceneService,
  type ApplicationApi,
} from '@officexr/world/app';
import type {
  WorldObjectKind,
  WorldObjectKindCatalogV1,
} from '@officexr/world/scenes';

function makeKind(
  id: string,
  dims?: { width: number; height: number; depth: number },
): WorldObjectKind {
  return {
    id,
    label: id,
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
    dimensions: dims,
  };
}

function makeApi(kinds: WorldObjectKind[]): ApplicationApi {
  const def: WorldObjectKindCatalogV1 = {
    schemaVersion: 1,
    updatedAt: 0,
    kinds,
  };
  const catalog = createCatalogService({
    defaultCatalog: def,
    apiPath: '',
  });
  const geometry = createInstanceGeometry({ catalog, voxelSize: 0.5 });
  return {
    voxelSize: 0.5,
    catalog,
    geometry,
    rooms: createRoomService({ geometry }),
    bake: createBakeService({
      catalog,
      loadGltf: () => Promise.reject(new Error('not used in this test')),
    }),
    scenes: createSceneService(),
  };
}

function wrapper(api: ApplicationApi) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <ApplicationProvider api={api}>{children}</ApplicationProvider>;
  };
}

describe('useApplication', () => {
  it('throws without a provider', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useApplication())).toThrow(
      /no <ApplicationProvider>/,
    );
    err.mockRestore();
  });

  it('returns the live api inside a provider', () => {
    const api = makeApi([]);
    const { result } = renderHook(() => useApplication(), {
      wrapper: wrapper(api),
    });
    expect(result.current).toBe(api);
  });
});

describe('useCatalog', () => {
  it('reflects live patchKind edits', () => {
    const api = makeApi([makeKind('a'), makeKind('b')]);
    const { result } = renderHook(() => useCatalog(), { wrapper: wrapper(api) });
    expect(result.current.map((k) => k.label)).toEqual(['a', 'b']);
    act(() => {
      api.catalog.patchKind('a', { label: 'A!' });
    });
    expect(result.current.find((k) => k.id === 'a')?.label).toBe('A!');
  });
});

describe('useKind', () => {
  it('returns undefined for unknown id', () => {
    const api = makeApi([makeKind('a')]);
    const { result } = renderHook(() => useKind('z'), { wrapper: wrapper(api) });
    expect(result.current).toBeUndefined();
  });

  it('re-renders on patchKind', () => {
    const api = makeApi([makeKind('a')]);
    const { result } = renderHook(() => useKind('a'), { wrapper: wrapper(api) });
    expect(result.current?.label).toBe('a');
    act(() => {
      api.catalog.patchKind('a', { label: 'updated' });
    });
    expect(result.current?.label).toBe('updated');
  });
});

describe('useInstanceAABB — regression guard', () => {
  it('recomputes when kind.dimensions changes via patchKind', () => {
    const api = makeApi([
      makeKind('blue', { width: 2, height: 2, depth: 2 }),
    ]);
    const { result } = renderHook(
      () => useInstanceAABB([0, 0, 0], 'blue'),
      { wrapper: wrapper(api) },
    );
    // Anchor lower-left convention: voxel (0,0,0) → world AABB
    // (0,0,0) → (w,h,d). The fallback localAABB (no baked GLTF AABB)
    // is X/Z-centered + Y-bottom, so anchored at voxel 0 the AABB
    // spans (0, 0, 0) → (2, 2, 2) for a 2 m cube.
    expect(result.current.min).toEqual([0, 0, 0]);
    expect(result.current.max).toEqual([2, 2, 2]);

    // Live edit: shrink the blue cube.
    act(() => {
      api.catalog.patchKind('blue', {
        dimensions: { width: 1, height: 1, depth: 1 },
      });
    });
    expect(result.current.min).toEqual([0, 0, 0]);
    expect(result.current.max).toEqual([1, 1, 1]);
  });
});
