// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createActions, createBus, createStore, MAX_PLACED_PROPS, PLACEABLE_KINDS, type PlacedProp } from '@officexr/sdk';
import { createPlaceMode } from '@officexr/world/motion';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBuildSession } from '../../place/buildSession';
import type { RequestPropOp } from '../../place/requestPropOp';
import { BuildActions } from './BuildActions';
import { BuildDone } from './BuildDone';
import { BuildKeyHints } from './BuildKeyHints';
import { BuildPalette } from './BuildPalette';
import { BuildStatus, FULL_TEXT, PLACED_TOAST_MS } from './BuildStatus';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const prop = (n: number): PlacedProp => ({ id: `placed:${n}`, kindId: 'prop_pool', position: [n, 0, 0], yawDeg: 0 });

function setup({ props = [] as PlacedProp[], live = true } = {}) {
  const store = createStore({ selfId: 'me', officeId: 'o' });
  const actions = createActions(store, createBus());
  actions.setPlacedProps(props);
  store.setState(() => ({ realtime: { ...store.getState().realtime, status: live ? 'live' : 'reconnecting' } }));
  const mode = createPlaceMode();
  mode.setOpen(true);
  const send = vi.fn<RequestPropOp>(async () => ({ ok: true as const }));
  const build = createBuildSession(mode, send, () => store.getState().placedProps);
  const ui = (
    <>
      <BuildPalette mode={mode} layout="portrait" />
      <BuildActions mode={mode} store={store} />
      <BuildStatus mode={mode} build={build} store={store} />
      <BuildDone mode={mode} />
    </>
  );
  return { store, actions, mode, send, build, ui };
}

const validGhost = { position: [3, 0, 4] as [number, number, number], valid: true, targetId: null };

describe('BuildPalette', () => {
  it('lists the placeable kinds and marks the selected one', () => {
    const { ui } = setup();
    render(ui);
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual(PLACEABLE_KINDS.map((k) => k.label));
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false', 'false']);
  });

  it('selects the tapped kind', () => {
    const { ui, mode } = setup();
    render(ui);
    fireEvent.click(screen.getByRole('radio', { name: 'Tricycle rack' }));
    expect(mode.get().kindId).toBe('prop_tricycle_rack');
    expect(screen.getByRole('radio', { name: 'Tricycle rack' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Pool' }).getAttribute('aria-checked')).toBe('false');
  });
});

describe('BuildActions', () => {
  it('Rotate turns the ghost a quarter turn each tap', () => {
    const { ui, mode } = setup();
    render(ui);
    fireEvent.click(screen.getByRole('button', { name: 'Rotate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rotate' }));
    expect(mode.get().yawDeg).toBe(180);
  });

  it('Place runs the registered place handler when the ghost is clear', () => {
    const { ui, mode } = setup();
    const onPlace = vi.fn();
    mode.onPlace(onPlace);
    render(ui);
    const place = screen.getByRole<HTMLButtonElement>('button', { name: 'Place' });
    expect(place.disabled).toBe(true);
    act(() => mode.setGhost(validGhost));
    expect(place.disabled).toBe(false);
    fireEvent.click(place);
    expect(onPlace).toHaveBeenCalledTimes(1);
  });

  it('Place is off for a blocked ghost, a full office and a dropped connection', () => {
    const blocked = setup();
    render(blocked.ui);
    act(() => blocked.mode.setGhost({ ...validGhost, valid: false }));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Place' }).disabled).toBe(true);
    cleanup();

    const full = setup({ props: Array.from({ length: MAX_PLACED_PROPS }, (_, i) => prop(i)) });
    render(full.ui);
    act(() => full.mode.setGhost(validGhost));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Place' }).disabled).toBe(true);
    cleanup();

    const offline = setup({ live: false });
    render(offline.ui);
    act(() => offline.mode.setGhost(validGhost));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Place' }).disabled).toBe(true);
  });
});

describe('BuildDone', () => {
  it('leaves build mode', () => {
    const { ui, mode } = setup();
    render(ui);
    mode.setGhost(validGhost);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(mode.get()).toMatchObject({ open: false, ghost: null });
  });
});

describe('BuildStatus', () => {
  it('counts the placed props against the limit', () => {
    const { ui, actions } = setup({ props: [prop(1), prop(2)] });
    render(ui);
    expect(screen.getByText('2 of 50 props')).toBeTruthy();
    act(() => actions.setPlacedProps([prop(1), prop(2), prop(3)]));
    expect(screen.getByText('3 of 50 props')).toBeTruthy();
  });

  it('says Blocked while the ghost cannot go where it is', () => {
    const { ui, mode } = setup();
    render(ui);
    expect(screen.queryByText('Blocked')).toBeNull();
    act(() => mode.setGhost({ ...validGhost, valid: false }));
    expect(screen.getByText('Blocked')).toBeTruthy();
  });

  it('explains a full office', () => {
    const { ui } = setup({ props: Array.from({ length: MAX_PLACED_PROPS }, (_, i) => prop(i)) });
    render(ui);
    expect(screen.getByText('50 of 50 props')).toBeTruthy();
    expect(screen.getByText(FULL_TEXT)).toBeTruthy();
  });

  it('shows a placement notice from the server', () => {
    const { ui, mode } = setup();
    render(ui);
    act(() => mode.setNotice('That spot is not allowed.'));
    expect(screen.getByText('That spot is not allowed.')).toBeTruthy();
  });

  it('shows Placed with Undo after a placement, which goes after 5 s', async () => {
    const { ui, build } = setup();
    render(ui);
    await act(() => build.host.send({ op: 'place', kindId: 'prop_scooter_rack', position: [1, 0, 1], yawDeg: 0 }));
    expect(screen.getByText('Placed Scooter rack')).toBeTruthy();
    act(() => void vi.advanceTimersByTime(PLACED_TOAST_MS));
    expect(screen.queryByText(/^Placed /)).toBeNull();
  });

  it('Undo removes the prop just placed and hides the toast', async () => {
    const { ui, build, actions, send } = setup();
    render(ui);
    await act(() => build.host.send({ op: 'place', kindId: 'prop_pool', position: [5, 0, 0], yawDeg: 0 }));
    act(() => actions.setPlacedProps([prop(5)]));
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Undo' })));
    expect(send).toHaveBeenLastCalledWith({ op: 'remove', id: 'placed:5' });
    expect(screen.queryByText(/^Placed /)).toBeNull();
  });
});

describe('BuildKeyHints', () => {
  it('lists the build keys', () => {
    render(<BuildKeyHints />);
    for (const [key, action] of [['Tab', 'next prop'], ['R', 'rotate'], ['Enter', 'place'], ['B', 'close']]) {
      expect(screen.getByText(key!)).toBeTruthy();
      expect(screen.getByText(action!)).toBeTruthy();
    }
  });
});
