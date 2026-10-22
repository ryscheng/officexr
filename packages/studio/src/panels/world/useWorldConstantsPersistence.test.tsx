import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  createActions,
  createBus,
  createStore,
  DEFAULT_WORLD_CONSTANTS,
  type WorldConstants,
} from '@officexr/sdk';
import {
  InMemoryWorldConstantsStorage,
  WorldConstantsPushError,
} from '@officexr/world/scenes';
import { SAVE_DEBOUNCE_MS } from './saveDebounce.ts';
import { useWorldConstantsPersistence } from './useWorldConstantsPersistence.ts';

function withWalkSpeed(walkSpeed: number): WorldConstants {
  return {
    ...DEFAULT_WORLD_CONSTANTS,
    animation: { ...DEFAULT_WORLD_CONSTANTS.animation, walkSpeed },
  };
}

function setup(storage: InMemoryWorldConstantsStorage) {
  const store = createStore({ selfId: 'me', officeId: 'office' });
  const actions = createActions(store, createBus());
  const hook = renderHook(() => useWorldConstantsPersistence({ store, actions, storage }));
  return { store, actions, hook };
}

const walkSpeedOf = (store: ReturnType<typeof createStore>) =>
  store.getState().worldConstants.animation.walkSpeed;

/** Lets pending promises and microtasks settle without moving the clock. */
const settle = () => act(() => vi.advanceTimersByTimeAsync(0));

describe('useWorldConstantsPersistence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies the saved doc on load', async () => {
    const { store, hook } = setup(new InMemoryWorldConstantsStorage({ seed: withWalkSpeed(7) }));
    expect(hook.result.current.status.type).toBe('loading');
    await settle();
    expect(walkSpeedOf(store)).toBe(7);
    expect(hook.result.current.status.type).toBe('clean');
  });

  it('falls back to the defaults when nothing is saved', async () => {
    const storage = new InMemoryWorldConstantsStorage();
    const store = createStore({ selfId: 'me', officeId: 'office' });
    const actions = createActions(store, createBus());
    actions.setWorldConstants(withWalkSpeed(9));
    renderHook(() => useWorldConstantsPersistence({ store, actions, storage }));
    await settle();
    expect(store.getState().worldConstants).toEqual(DEFAULT_WORLD_CONSTANTS);
  });

  it('applies edits at once and saves once, 500 ms after the last one', async () => {
    const storage = new InMemoryWorldConstantsStorage();
    const save = vi.spyOn(storage, 'save');
    const { store, hook } = setup(storage);
    await settle();

    for (const speed of [2, 3, 4]) {
      act(() => hook.result.current.edit(() => withWalkSpeed(speed)));
      await act(() => vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS - 100));
    }
    expect(walkSpeedOf(store)).toBe(4);
    expect(hook.result.current.status.type).toBe('dirty');
    expect(save).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0].animation.walkSpeed).toBe(4);
    expect(hook.result.current.status.type).toBe('clean');
  });

  it('keeps a pending edit over a server push', async () => {
    const { store, actions, hook } = setup(new InMemoryWorldConstantsStorage());
    await settle();

    act(() => hook.result.current.edit(() => withWalkSpeed(5)));
    actions.setWorldConstants(withWalkSpeed(1));
    await settle();
    expect(walkSpeedOf(store)).toBe(5);
  });

  it('keeps save N over the echo of save N-1 arriving while N is in flight', async () => {
    const storage = new InMemoryWorldConstantsStorage();
    const { store, actions, hook } = setup(storage);
    await settle();

    act(() => hook.result.current.edit(() => withWalkSpeed(2)));
    await act(() => vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS));
    expect(hook.result.current.status.type).toBe('clean');

    let finishSave!: () => void;
    vi.spyOn(storage, 'save').mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishSave = resolve)),
    );
    act(() => hook.result.current.edit(() => withWalkSpeed(3)));
    await act(() => vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS));
    expect(hook.result.current.status.type).toBe('saving');

    actions.setWorldConstants(withWalkSpeed(2));
    await settle();
    expect(walkSpeedOf(store)).toBe(3);

    await act(async () => finishSave());
    expect(hook.result.current.status.type).toBe('clean');

    actions.setWorldConstants(withWalkSpeed(8));
    await settle();
    expect(walkSpeedOf(store)).toBe(8);
  });

  it('names the failed push target and saves again on retry', async () => {
    const storage = new InMemoryWorldConstantsStorage();
    const save = vi
      .spyOn(storage, 'save')
      .mockRejectedValueOnce(
        new WorldConstantsPushError([{ target: 'http://realtime-a:8787', status: 401 }]),
      );
    const { hook } = setup(storage);
    await settle();

    act(() => hook.result.current.edit(() => withWalkSpeed(6)));
    await act(() => vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS));
    expect(hook.result.current.status).toMatchObject({
      type: 'failed',
      op: 'save',
      message: expect.stringContaining('http://realtime-a:8787'),
    });

    act(() => hook.result.current.retry());
    await settle();
    expect(save).toHaveBeenCalledTimes(2);
    expect(hook.result.current.status.type).toBe('clean');
    expect((await storage.load())?.animation.walkSpeed).toBe(6);
  });

  it('ignores edits after a failed load and reloads on retry', async () => {
    const storage = new InMemoryWorldConstantsStorage({ seed: withWalkSpeed(7) });
    const load = vi.spyOn(storage, 'load').mockRejectedValueOnce(new Error('offline'));
    const save = vi.spyOn(storage, 'save');
    const { store, hook } = setup(storage);
    await settle();
    expect(hook.result.current.status).toMatchObject({ type: 'failed', op: 'load' });

    act(() => hook.result.current.edit(() => withWalkSpeed(2)));
    await act(() => vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS));
    expect(save).not.toHaveBeenCalled();
    expect(walkSpeedOf(store)).not.toBe(2);

    act(() => hook.result.current.retry());
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
    expect(walkSpeedOf(store)).toBe(7);
    expect(hook.result.current.status.type).toBe('clean');
  });

  it('names a plain save failure', async () => {
    const storage = new InMemoryWorldConstantsStorage();
    vi.spyOn(storage, 'save').mockRejectedValueOnce(new Error('disk full'));
    const { hook } = setup(storage);
    await settle();

    act(() => hook.result.current.edit(() => withWalkSpeed(6)));
    await act(() => vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS));
    expect(hook.result.current.status).toEqual({
      type: 'failed',
      op: 'save',
      message: 'save failed: disk full',
    });
  });

  it('saves the pending edit once when unmounted before the debounce fires', async () => {
    const storage = new InMemoryWorldConstantsStorage();
    const save = vi.spyOn(storage, 'save');
    const { hook } = setup(storage);
    await settle();

    act(() => hook.result.current.edit(() => withWalkSpeed(3)));
    hook.unmount();
    await act(() => vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 2));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0].animation.walkSpeed).toBe(3);
  });
});
