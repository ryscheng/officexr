// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBus, createStore, createActions } from '@officexr/sdk';
import { PokeToast, POKE_TOAST_MS } from './PokeToast';

const setup = () => {
  const store = createStore({ selfId: 'me@example.com', officeId: 'office' });
  const bus = createBus();
  const actions = createActions(store, bus);
  actions.applyRemoteAvatar('alice@example.com', { model: 'Rogue' }, 'Alice', 0);
  render(<PokeToast bus={bus} store={store} selfId="me@example.com" />);
  return bus;
};

describe('PokeToast', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('names the poker when the local player is poked, then goes away', () => {
    const bus = setup();
    act(() => bus.emit({ kind: 'poke:received', fromId: 'alice@example.com', targetId: 'me@example.com', at: 1 }));
    expect(screen.getByText('Poked by Alice')).toBeTruthy();
    act(() => void vi.advanceTimersByTime(POKE_TOAST_MS + 10));
    expect(screen.queryByText('Poked by Alice')).toBeNull();
  });

  it('stays quiet for other targets, for pokes at nobody and for your own poke', () => {
    const bus = setup();
    act(() => bus.emit({ kind: 'poke:received', fromId: 'alice@example.com', targetId: 'bob@example.com', at: 1 }));
    act(() => bus.emit({ kind: 'poke:received', fromId: 'alice@example.com', targetId: null, at: 2 }));
    act(() => bus.emit({ kind: 'poke:received', fromId: 'me@example.com', targetId: 'me@example.com', at: 3 }));
    expect(screen.queryByText(/Poked by/)).toBeNull();
  });
});
