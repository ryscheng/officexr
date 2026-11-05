// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { act } from 'react';
import { createBus, createStore } from '@officexr/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PingPrefs } from './pingPrefs';
import { usePingReceiver } from './usePingReceiver';

afterEach(cleanup);

describe('usePingReceiver', () => {
  const prefs: PingPrefs = { sound: { type: 'library', name: 'bell.mp3' }, notify: true };

  function setup(players: Record<string, { name: string }>) {
    const bus = createBus();
    const store = createStore({ selfId: 'me#t0', officeId: 'o' });
    store.setState((s) => ({ ...s, players: players as never }));
    const deps = { readPrefs: () => prefs, play: vi.fn(), notify: vi.fn() };
    renderHook(() => usePingReceiver(bus, store, deps));
    return { bus, deps };
  }

  it('plays the chosen sound and notifies with the sender name from the store', () => {
    const { bus, deps } = setup({ 'ada#t1': { name: 'Ada Lovelace' } });
    act(() => bus.emit({ kind: 'ping:received', fromId: 'ada#t1', at: 1 }));
    expect(deps.play).toHaveBeenCalledWith(prefs.sound, null);
    expect(deps.notify).toHaveBeenCalledWith(prefs, 'Ada Lovelace');
  });

  it('falls back to the login when the sender is not in the store', () => {
    const { bus, deps } = setup({});
    act(() => bus.emit({ kind: 'ping:received', fromId: 'grace#t9', at: 1 }));
    expect(deps.notify).toHaveBeenCalledWith(prefs, 'grace');
  });
});
