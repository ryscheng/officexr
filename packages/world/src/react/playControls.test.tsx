// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActions, createStore } from '@officexr/sdk';
import { PlayControlsProvider, usePlayControls } from './playControls.tsx';
import { createAutoWalk } from './useAutoWalk.ts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderControls() {
  const store = createStore({ selfId: 'me', officeId: 'o' });
  const actions = createActions(store);
  actions.upsertPlayer({ id: 'me', pos: { x: 0, y: 1, z: 0 } });
  actions.upsertPlayer({ id: 'bob', pos: { x: 0, y: 1, z: 10 } });
  let clock = 0;
  const autoWalk = createAutoWalk(store, 'me', { now: () => clock });
  let renders = 0;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PlayControlsProvider controls={autoWalk}>{children}</PlayControlsProvider>
  );
  const hook = renderHook(
    () => {
      renders += 1;
      return usePlayControls();
    },
    { wrapper },
  );
  return { ...hook, autoWalk, renders: () => renders, tick: (ms: number) => (clock += ms) };
}

describe('usePlayControls', () => {
  it('re-renders when the walk state changes, not on every frame', () => {
    const { result, autoWalk, renders, tick } = renderControls();
    expect(result.current.state).toEqual({ type: 'idle' });
    const initial = renders();

    act(() => result.current.goTo('bob'));
    expect(result.current.state).toMatchObject({ type: 'walking', targetId: 'bob' });
    expect(autoWalk.getState()).toEqual({ type: 'walking', targetId: 'bob', route: [] });
    expect(renders()).toBe(initial + 1);

    // Each frame lands past the re-plan interval; re-plans that change nothing public don't re-render.
    act(() => {
      for (let frame = 0; frame < 10; frame++) {
        tick(600);
        expect(autoWalk.intent({ x: 0, y: 1, z: 0 })).toEqual({ x: 0, z: 1 });
      }
    });
    expect(renders()).toBe(initial + 1);

    act(() => result.current.cancel());
    expect(result.current.state).toEqual({ type: 'idle' });
    expect(renders()).toBe(initial + 2);

    act(() => result.current.cancel());
    expect(renders()).toBe(initial + 2);
  });

  it('throws outside a provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => usePlayControls())).toThrow(/PlayControlsProvider/);
  });
});
