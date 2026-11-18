// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { createActions, createStore, POSITION_CONSTANTS } from '@officexr/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLocalActivity } from './useLocalActivity';

afterEach(cleanup);

const SELF = 'me#t0';

function setup() {
  const store = createStore({ selfId: SELF, officeId: 'o' });
  const sdk = createActions(store);
  sdk.upsertPlayer({ id: SELF });
  const target = new EventTarget();
  const registered: { type: string; options: unknown }[] = [];
  const removed: { type: string; options: unknown }[] = [];
  const recordingTarget = {
    addEventListener: (type: string, fn: never, options?: unknown) => {
      registered.push({ type, options });
      target.addEventListener(type, fn, options as AddEventListenerOptions);
    },
    removeEventListener: (type: string, fn: never, options?: unknown) => {
      removed.push({ type, options });
      target.removeEventListener(type, fn, options as AddEventListenerOptions);
    },
  };
  let now = 0;
  const markSelfActive = vi.fn<(at: number) => void>();
  const view = renderHook(() => useLocalActivity(store, { markSelfActive }, SELF, { target: recordingTarget, clock: () => now }));
  const advance = (ms: number) => void (now += ms);
  const moveTo = (x: number, yaw = 0) =>
    act(() => sdk.setSelfPosition({ x, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, yaw, false));
  return { store, target, registered, removed, markSelfActive, advance, moveTo, view };
}

describe('useLocalActivity', () => {
  it('registers and removes capture, passive listeners', () => {
    const { registered, removed, view } = setup();
    const expected = ['keydown', 'pointerdown', 'pointermove', 'wheel'].map((type) => ({ type, options: { capture: true, passive: true } }));
    expect(registered).toEqual(expected);
    view.unmount();
    expect(removed).toEqual(expected);
  });

  it('marks once on mount', () => {
    const { markSelfActive } = setup();
    expect(markSelfActive).toHaveBeenCalledExactlyOnceWith(0);
  });

  it.each(['keydown', 'pointerdown', 'pointermove', 'wheel'])('marks on %s', (name) => {
    const { target, markSelfActive, advance } = setup();
    advance(1000);
    target.dispatchEvent(new Event(name));
    expect(markSelfActive).toHaveBeenLastCalledWith(1000);
    expect(markSelfActive).toHaveBeenCalledTimes(2);
  });

  it('marks when moved past deltaP or turned past deltaY', () => {
    const { markSelfActive, advance, moveTo } = setup();
    advance(1000);
    moveTo(POSITION_CONSTANTS.deltaP * 2);
    expect(markSelfActive).toHaveBeenCalledTimes(2);
    advance(1000);
    moveTo(POSITION_CONSTANTS.deltaP * 2, POSITION_CONSTANTS.deltaY * 2);
    expect(markSelfActive).toHaveBeenCalledTimes(3);
  });

  it('does not mark for an unchanged or near-identical pose', () => {
    const { markSelfActive, advance, moveTo } = setup();
    advance(1000);
    moveTo(0);
    moveTo(POSITION_CONSTANTS.deltaP / 10, POSITION_CONSTANTS.deltaY / 10);
    expect(markSelfActive).toHaveBeenCalledTimes(1);
  });

  it('does not mark when yaw wraps around pi without turning', () => {
    const { markSelfActive, advance, moveTo } = setup();
    moveTo(0, Math.PI - 0.01);
    advance(1000);
    moveTo(0, -Math.PI + 0.01);
    expect(markSelfActive).toHaveBeenCalledTimes(2);
    advance(1000);
    moveTo(0, Math.PI - 0.01);
    expect(markSelfActive).toHaveBeenCalledTimes(2);
  });

  it('keeps comparing against the last marking pose while throttled', () => {
    const { markSelfActive, advance, moveTo } = setup();
    moveTo(1);
    expect(markSelfActive).toHaveBeenCalledTimes(1);
    advance(1000);
    moveTo(1.001);
    expect(markSelfActive).toHaveBeenCalledTimes(2);
  });

  it('coalesces calls within one second across signals', () => {
    const { target, markSelfActive, advance, view } = setup();
    advance(999);
    target.dispatchEvent(new Event('keydown'));
    act(() => view.result.current());
    expect(markSelfActive).toHaveBeenCalledTimes(1);
    advance(1);
    target.dispatchEvent(new Event('keydown'));
    expect(markSelfActive).toHaveBeenCalledTimes(2);
  });

  it('stops marking after unmount', () => {
    const { target, markSelfActive, advance, moveTo, view } = setup();
    view.unmount();
    advance(5000);
    target.dispatchEvent(new Event('keydown'));
    moveTo(10);
    expect(markSelfActive).toHaveBeenCalledTimes(1);
  });

  it('drives the real SDK action', () => {
    const store = createStore({ selfId: SELF, officeId: 'o' });
    const actions = createActions(store);
    actions.upsertPlayer({ id: SELF });
    renderHook(() => useLocalActivity(store, actions, SELF, { target: new EventTarget(), clock: () => 7 }));
    expect(store.getState().players[SELF].lastActiveAt).toBe(7);
  });
});
