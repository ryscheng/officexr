// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActions, createStore } from '@officexr/sdk';
import type { PlanFn } from '../nav/autoWalk.ts';
import type { NavGrid } from '../nav/grid.ts';
import { BODY_Y } from '../physics/rules.ts';
import { createAutoWalk, isGroundTargetId, useAutoWalk } from './useAutoWalk.ts';

afterEach(cleanup);

describe('createAutoWalk', () => {
  it('plans between both players’ feet, using the store’s charRadius', () => {
    const store = createStore({ selfId: 'me', officeId: 'o' });
    const actions = createActions(store);
    store.setState((s) => ({ worldSettings: { ...s.worldSettings, charRadius: 0.3 } }));
    actions.upsertPlayer({ id: 'me', pos: { x: 0, y: 1, z: 0 } });
    actions.upsertPlayer({ id: 'bob', pos: { x: 0, y: 3, z: 10 } });
    const plan = vi.fn<PlanFn>(() => []);
    const autoWalk = createAutoWalk(store, 'me', { plan, now: () => 0 });
    const grid = {} as NavGrid;
    autoWalk.setGrid(grid);

    autoWalk.goTo('bob');

    expect(plan).toHaveBeenCalledWith(
      grid,
      { x: 0, y: 1 + BODY_Y - 0.3, z: 0 },
      { x: 0, y: 3 + BODY_Y - 0.3, z: 10 },
    );
  });
});

describe('goToGround', () => {
  const setup = (plan: PlanFn = () => []) => {
    const store = createStore({ selfId: 'me', officeId: 'o' });
    createActions(store).upsertPlayer({ id: 'me', pos: { x: 0, y: 1, z: 0 } });
    const autoWalk = createAutoWalk(store, 'me', { plan, now: () => 0 });
    return { store, autoWalk };
  };

  it('walks straight to the point when there is no grid, and returns it', () => {
    const { autoWalk } = setup();
    expect(autoWalk.goToGround(5, 6)).toEqual({ x: 5, z: 6 });
    const state = autoWalk.getState();
    expect(state.type).toBe('walking');
    expect(state.type === 'walking' && isGroundTargetId(state.targetId)).toBe(true);
  });

  it('walks to the nearest standable spot and plans to it', () => {
    const plan = vi.fn<PlanFn>(() => []);
    const { autoWalk } = setup(plan);
    const feetY = 1 + BODY_Y - 0.4;
    const grid = { origin: { x: 0, z: 0 }, cellSize: 1, width: 3, height: 1, maxStep: 0.5, walkable: Uint8Array.of(0, 0, 1), surface: Float32Array.of(feetY, feetY, feetY) } as NavGrid;
    autoWalk.setGrid(grid);
    expect(autoWalk.goToGround(0.5, 0.5)).toEqual({ x: 2.5, z: 0.5 });
    expect(plan).toHaveBeenCalledWith(grid, expect.anything(), { x: 2.5, y: feetY, z: 0.5 });
  });

  it('refuses a point with nothing standable near it and starts no walk', () => {
    const { autoWalk } = setup();
    autoWalk.setGrid({ origin: { x: 0, z: 0 }, cellSize: 1, width: 1, height: 1, maxStep: 0.5, walkable: Uint8Array.of(0), surface: Float32Array.of(NaN) } as NavGrid);
    expect(autoWalk.goToGround(0.5, 0.5)).toBeNull();
    expect(autoWalk.getState()).toEqual({ type: 'idle' });
  });

  it('refuses a point no route leads to and stands still', () => {
    const { autoWalk } = setup(() => null);
    autoWalk.setGrid({ origin: { x: 0, z: 0 }, cellSize: 1, width: 1, height: 1, maxStep: 0.5, walkable: Uint8Array.of(1), surface: Float32Array.of(1 + BODY_Y - 0.4) } as NavGrid);
    expect(autoWalk.goToGround(0.5, 0.5)).toBeNull();
    expect(autoWalk.getState()).toEqual({ type: 'idle' });
  });

  it('is replaced by a second tap, cancelled by cancel, and ends on arrival', () => {
    const { store, autoWalk } = setup();
    autoWalk.goToGround(5, 0);
    const first = autoWalk.getState();
    autoWalk.goToGround(0, 5);
    const second = autoWalk.getState();
    expect(second).toMatchObject({ type: 'walking' });
    expect(second.type === 'walking' && first.type === 'walking' && second.targetId !== first.targetId).toBe(true);
    autoWalk.cancel();
    expect(autoWalk.getState()).toEqual({ type: 'idle' });

    autoWalk.goToGround(0.2, 0);
    createActions(store).upsertPlayer({ id: 'me', pos: { x: 0.2, y: 1, z: 0 } });
    expect(autoWalk.intent({ x: 0.2, y: 1, z: 0 })).toBeNull();
    expect(autoWalk.getState()).toEqual({ type: 'idle' });
  });
});

describe('useAutoWalk', () => {
  it('keeps its controller across renders and starts an idle one for a new selfId', () => {
    const store = createStore({ selfId: 'me', officeId: 'o' });
    const actions = createActions(store);
    actions.upsertPlayer({ id: 'me', pos: { x: 0, y: 1, z: 0 } });
    actions.upsertPlayer({ id: 'bob', pos: { x: 0, y: 1, z: 10 } });
    const { result, rerender } = renderHook(({ selfId }) => useAutoWalk(store, selfId, null), {
      initialProps: { selfId: 'me' },
    });
    const first = result.current;
    act(() => first.goTo('bob'));
    expect(first.getState()).toMatchObject({ type: 'walking' });

    rerender({ selfId: 'me' });
    expect(result.current).toBe(first);

    rerender({ selfId: 'bob' });
    expect(result.current).not.toBe(first);
    expect(result.current.getState()).toEqual({ type: 'idle' });
  });
});
