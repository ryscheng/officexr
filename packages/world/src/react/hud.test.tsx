// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TeleportFlash } from './hud.tsx';
import type { SeatingControllerState } from './useSeating.ts';

afterEach(cleanup);

function fakeSeating() {
  let state: SeatingControllerState = { nearbySeatId: null, hasDesk: true, refusal: null, teleports: 0 };
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    teleport() {
      state = { ...state, teleports: state.teleports + 1 };
      listeners.forEach((cb) => cb());
    },
  };
}

describe('TeleportFlash', () => {
  it('shows nothing until a teleport, then a fresh flash for each one', () => {
    const seating = fakeSeating();
    const { container } = render(<TeleportFlash seating={seating} />);
    expect(container.querySelector('[data-teleport-flash]')).toBeNull();

    act(() => seating.teleport());
    const first = container.querySelector('[data-teleport-flash]');
    expect(first).not.toBeNull();

    act(() => seating.teleport());
    const second = container.querySelector('[data-teleport-flash]');
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
  });
});
