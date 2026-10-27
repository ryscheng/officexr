// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { DEFAULT_WORLD_CONSTANTS, createActions, createStore } from '@officexr/sdk';
import { useWorldConstants } from './useWorldConstants.ts';

afterEach(cleanup);

describe('useWorldConstants', () => {
  it('re-renders with constants applied after mount, without remounting', () => {
    const store = createStore({ selfId: 'me', officeId: 'o' });
    const actions = createActions(store);
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useWorldConstants(store);
    });
    expect(result.current).toEqual(DEFAULT_WORLD_CONSTANTS);

    const next = {
      ...DEFAULT_WORLD_CONSTANTS,
      proximity: { ...DEFAULT_WORLD_CONSTANTS.proximity, outerRadius: 9 },
      lighting: { ...DEFAULT_WORLD_CONSTANTS.lighting, sunIntensity: 0.1 },
    };
    act(() => actions.setWorldConstants(next));

    expect(result.current.proximity.outerRadius).toBe(9);
    expect(result.current.lighting).toEqual(next.lighting);
    expect(renders).toBe(2);
  });
});
