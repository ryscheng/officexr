// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { createBus, createStore } from '@officexr/sdk';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PingPrefs } from './pingPrefs';
import { usePingReceiver } from './usePingReceiver';

const catalog = { sounds: [{ name: 'bell', size: 1, updatedAt: 1 }] };
const prefs: PingPrefs = { sound: { type: 'library', name: 'bell' }, notify: true };

// The catalog is fetched once per module load, so one stub serves every test.
beforeAll(() => {
  vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify(catalog))));
});
afterAll(() => vi.unstubAllGlobals());
afterEach(cleanup);

function setup(players: Record<string, { name: string }>) {
  const bus = createBus();
  const store = createStore({ selfId: 'me#t0', officeId: 'o' });
  store.setState((s) => ({ ...s, players: players as never }));
  const deps = { prepare: vi.fn(), readPrefs: () => prefs, play: vi.fn(), notify: vi.fn() };
  const view = renderHook(() => usePingReceiver(bus, store, deps));
  const ping = (fromId: string) => act(() => bus.emit({ kind: 'ping:received', fromId, at: 1 }));
  return { ping, deps, view };
}

describe('usePingReceiver', () => {
  it('plays with no catalog until it loads, then with the loaded catalog', async () => {
    const { ping, deps } = setup({ 'ada#t1': { name: 'Ada' } });
    ping('ada#t1');
    expect(deps.play).toHaveBeenLastCalledWith(prefs.sound, null);
    await act(async () => {});
    ping('ada#t1');
    expect(deps.play).toHaveBeenLastCalledWith(prefs.sound, catalog);
  });

  it('notifies with the sender name from the store', async () => {
    const { ping, deps } = setup({ 'ada#t1': { name: 'Ada Lovelace' } });
    await act(async () => {});
    ping('ada#t1');
    expect(deps.notify).toHaveBeenCalledWith(prefs, 'Ada Lovelace');
  });

  it('falls back to the login when the sender is not in the store', async () => {
    const { ping, deps } = setup({});
    await act(async () => {});
    ping('grace#t9');
    expect(deps.notify).toHaveBeenCalledWith(prefs, 'grace');
  });

  it('prepares on mount and stops listening on unmount', async () => {
    const { ping, deps, view } = setup({});
    await act(async () => {});
    expect(deps.prepare).toHaveBeenCalledTimes(1);
    view.unmount();
    ping('ada#t1');
    expect(deps.play).not.toHaveBeenCalled();
  });
});
