import { describe, expect, it, vi } from 'vitest';
import { createActions, createStore } from '@officexr/sdk';
import type { PlanFn } from '../nav/autoWalk.ts';
import type { NavGrid } from '../nav/grid.ts';
import { BODY_Y } from '../physics/rules.ts';
import { createAutoWalk } from './useAutoWalk.ts';

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
