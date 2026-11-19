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

describe('useStoreWorldObjects with placed props', () => {
  it('adds the placed props after the map instances, and follows later placements', () => {
    const store = storeWith('b/x');
    store.setState(() => ({ placedProps: [{ id: 'placed:1', kindId: 'prop_pool', position: [4, 4, 6], yawDeg: 90 }] }));
    const { result } = render(store);

    expect(result.current.instances.map((i) => [i.id, i.kindId, i.yawDeg])).toEqual([
      ['b/x', 'colored_block_blue', undefined],
      ['placed:1', 'prop_pool', 90],
    ]);

    act(() => store.setState(() => ({ placedProps: [] })));
    expect(result.current.instances.map((i) => i.id)).toEqual(['b/x']);
  });

  it('keeps placed props when an exclude drops map instances', () => {
    const store = storeWith('b/layout/x');
    store.setState(() => ({ placedProps: [{ id: 'placed:1', kindId: 'prop_pool', position: [0, 0, 0], yawDeg: 0 }] }));
    const { result } = render(store, excludeLayoutInstances([{ roomInstanceId: 'b' }]));

    expect(result.current.instances.map((i) => i.id)).toEqual(['placed:1']);
  });
});

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
