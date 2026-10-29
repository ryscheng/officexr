// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Profiler, type ReactNode } from 'react';
import { createActions, createBus, createStore } from '@officexr/sdk';
import { createViewYaw, NavGridProvider, useWorldFocus, ViewYawProvider, type NavGrid } from '@officexr/world/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Minimap } from './Minimap';
import { navGridPath } from './minimapGeometry';

const realMatchMedia = window.matchMedia;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.matchMedia = realMatchMedia;
});

function fakePointer(coarse: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query === '(pointer: coarse)' && coarse,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

const grid: NavGrid = {
  origin: { x: -2, z: -2 },
  cellSize: 1,
  width: 4,
  height: 4,
  maxStep: 0.3,
  walkable: Uint8Array.from('0110011001100000', Number),
  surface: new Float32Array(16),
};

function WorldFocus() {
  return <output aria-label="world focus">{String(useWorldFocus())}</output>;
}

function seed({ coarse = false, navGrid = grid as NavGrid | null, onRender = () => {} } = {}) {
  fakePointer(coarse);
  const store = createStore({ selfId: 'me', officeId: 'o' });
  const actions = createActions(store, createBus());
  const viewYaw = createViewYaw();
  let t = 0;
  const clock = () => t;
  actions.upsertPlayer({ id: 'me', name: 'Me', pos: { x: 0, y: 0, z: 0 } });
  const peer = (id: string, name: string, pos: { x: number; z: number }) =>
    actions.upsertPlayer({ id, name, pos: { ...pos, y: 0 } });
  peer('ann', 'Ann', { x: 0, z: -12 });
  peer('bob', 'Bob', { x: 0.4, z: 0 });
  peer('dan', 'Dan', { x: 3, z: 0 });
  actions.applyRemotePresence('ann', 'available', 'speaking', 0);
  actions.applyRemotePresence('bob', 'away', 'muted', 0);
  actions.recordDeparted('dan', 0);
  actions.removePlayer('dan');
  vi.useFakeTimers();
  const wrap = (ui: ReactNode) => (
    <NavGridProvider value={navGrid}>
      <ViewYawProvider viewYaw={viewYaw}>{ui}</ViewYawProvider>
    </NavGridProvider>
  );
  render(
    wrap(
      <>
        <WorldFocus />
        <Profiler id="map" onRender={onRender}>
          <Minimap store={store} clock={clock} />
        </Profiler>
      </>,
    ),
  );
  return {
    actions,
    viewYaw,
    setTime: (ms: number) => {
      t = ms;
    },
  };
}

const marker = (name: string) => screen.getByRole('img', { name: name === 'You' ? name : new RegExp(`^${name}, `) });
const dotOf = (name: string) => marker(name).querySelector('circle')!;
const map = () => screen.queryByRole('group', { name: 'Map' });
const floorPlan = () => map()?.querySelector('path[transform]') ?? null;

describe('Minimap', () => {
  it('shows you and one dot per present user, coloured by status and labelled with distance', () => {
    seed();
    expect(marker('You')).toBeTruthy();
    expect(dotOf('Ann').getAttribute('class')).toContain('fill-green-500');
    expect(dotOf('Bob').getAttribute('class')).toContain('fill-yellow-400');
    expect(screen.getByRole('img', { name: 'Ann, 12 m' }).textContent).toBe('Ann12 m');
    expect(screen.getByRole('img', { name: 'Bob, <1 m' }).textContent).toBe('Bob<1 m');
    expect(screen.queryByRole('img', { name: /^Dan/ })).toBeNull();
  });

  it('turns a silent user red once stale', () => {
    const { setTime } = seed();
    act(() => {
      setTime(20_000);
      vi.advanceTimersByTime(1000);
    });
    expect(dotOf('Ann').getAttribute('class')).toContain('fill-red-500');
  });

  it('turns with the view so what is ahead stays up', () => {
    const { viewYaw } = seed();
    const cx = () => Number(dotOf('Ann').getAttribute('cx'));
    const cy = () => Number(dotOf('Ann').getAttribute('cy'));
    expect(cx()).toBeCloseTo(90);
    expect(cy()).toBeLessThan(90);
    act(() => viewYaw.set(Math.PI / 2));
    expect(cx()).toBeGreaterThan(90);
    expect(cy()).toBeCloseTo(90);
  });

  it('draws the walkable floor plan from the nav grid', () => {
    seed();
    expect(floorPlan()?.getAttribute('d')).toBe(navGridPath(grid));
  });

  it('shows only you and the dots while there is no nav grid', () => {
    seed({ navGrid: null });
    expect(floorPlan()).toBeNull();
    expect(marker('You')).toBeTruthy();
    expect(marker('Ann')).toBeTruthy();
  });

  it('is open on a fine pointer and collapsed on a coarse one', () => {
    seed();
    const button = screen.getByRole('button', { name: 'Hide map' });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-controls')).toBe(map()?.id);
    cleanup();
    seed({ coarse: true });
    expect(screen.getByRole('button', { name: 'Show map' }).getAttribute('aria-expanded')).toBe('false');
    expect(map()).toBeNull();
  });

  it('toggles from its header and gives the keyboard back to the world', () => {
    seed();
    const focus = screen.getByRole('status', { name: 'world focus' });
    const press = (name: string) => {
      const button = screen.getByRole('button', { name });
      fireEvent.mouseDown(button);
      expect(focus.textContent).toBe('false');
      fireEvent.click(button);
    };
    press('Hide map');
    expect(map()).toBeNull();
    expect(focus.textContent).toBe('true');
    press('Show map');
    expect(map()).toBeTruthy();
    expect(focus.textContent).toBe('true');
  });

  it('re-renders when someone moves half a metre, not on every small move', () => {
    const onRender = vi.fn();
    const { actions } = seed({ onRender });
    const renders = onRender.mock.calls.length;
    act(() => actions.upsertPlayer({ id: 'ann', pos: { x: 0.1, y: 0, z: -12.2 } }));
    act(() => actions.upsertPlayer({ id: 'me', pos: { x: 0.1, y: 0, z: 0.1 } }));
    expect(onRender).toHaveBeenCalledTimes(renders);
    act(() => actions.upsertPlayer({ id: 'ann', pos: { x: 0, y: 0, z: -13.6 } }));
    expect(onRender).toHaveBeenCalledTimes(renders + 1);
    expect(screen.getByRole('img', { name: 'Ann, 13 m' })).toBeTruthy();
    act(() => actions.upsertPlayer({ id: 'me', pos: { x: 0.2, y: 0, z: 0.1 } }));
    expect(onRender).toHaveBeenCalledTimes(renders + 2);
  });
});
