// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { createStore, type ObjectInstance, type Store } from '@officexr/sdk';
import { excludeLayoutInstances, useStoreWorldObjects } from './useStoreWorldObjects.ts';

afterEach(() => {
  cleanup();
});

const instance = (id: string): ObjectInstance => ({
  id,
  sourceCommandId: id,
  kindId: 'colored_block_blue',
  position: [0, 0, 0],
});

function storeWith(...ids: string[]): Store {
  const store = createStore({ selfId: 'me', officeId: 'o' });
  store.setState(() => ({ worldObjects: { cubeSize: 0.5, instances: ids.map(instance) } }));
  return store;
}

const render = (store: Store, exclude?: Parameters<typeof useStoreWorldObjects>[1]) =>
  renderHook(() => useStoreWorldObjects(store, exclude));

describe('useStoreWorldObjects', () => {
  it("drops only the listed placements' layout instances", () => {
    const store = storeWith('b/layout/x', 'b/x', 'c/layout/x');
    const { result } = render(store, excludeLayoutInstances([{ roomInstanceId: 'b' }]));

    expect(result.current.instances.map((i) => i.id)).toEqual(['b/x', 'c/layout/x']);
  });

  it('returns the store snapshot itself without an exclude', () => {
    const store = storeWith('b/layout/x');
    const { result } = render(store, excludeLayoutInstances([]));

    expect(result.current).toBe(store.getState().worldObjects);
  });

  it('follows store updates, still excluding', () => {
    const store = storeWith('b/layout/x');
    const { result } = render(store, excludeLayoutInstances([{ roomInstanceId: 'b' }]));
    expect(result.current.instances).toEqual([]);

    act(() => {
      store.setState(() => ({ worldObjects: { cubeSize: 0.5, instances: ['b/layout/y', 'd/x'].map(instance) } }));
    });

    expect(result.current.instances.map((i) => i.id)).toEqual(['d/x']);
  });
});
