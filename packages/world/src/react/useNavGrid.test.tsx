// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { createActions, createStore, type ObjectInstance } from '@officexr/sdk';
import { createDefaultApi } from '../app/create-default-api.ts';
import { ApplicationProvider } from './application-context.tsx';
import { useBuildNavGrid } from './useNavGrid.tsx';

afterEach(cleanup);

const floorTile = (x: number, z: number): ObjectInstance => ({
  id: `floor@${x},${z}`,
  sourceCommandId: 'floor',
  kindId: 'unknown_kind',
  position: [x, 0, z],
});

describe('useBuildNavGrid', () => {
  it('is null until the store has world objects, then keeps its grid across unrelated updates', () => {
    const store = createStore({ selfId: 'me', officeId: 'o' });
    const actions = createActions(store);
    const api = createDefaultApi({ fetcher: async () => new Response('{}', { status: 404 }) });
    const { result } = renderHook(() => useBuildNavGrid(store), {
      wrapper: ({ children }) => <ApplicationProvider api={api}>{children}</ApplicationProvider>,
    });
    expect(result.current).toBeNull();

    const instances: ObjectInstance[] = [];
    for (let x = 0; x < 8; x++) {
      for (let z = 0; z < 8; z++) {
        instances.push(floorTile(x, z));
      }
    }
    act(() => actions.setWorldObjects({ cubeSize: 0.5, instances }));
    const grid = result.current;
    expect(grid).not.toBeNull();
    expect(grid!.walkable.some((w) => w === 1)).toBe(true);

    act(() => actions.setSelfPosition({ x: 1, y: 0.5, z: 1 }, { x: 0, y: 0, z: 0 }, 0, false));
    expect(result.current).toBe(grid);
  });
});
