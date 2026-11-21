// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { createActions, createBus, createStore } from '@officexr/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArrivalBubble } from './ArrivalBubble';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const setup = () => {
  const store = createStore({ selfId: 'me', officeId: 'o' });
  const actions = createActions(store, createBus());
  actions.upsertPlayer({ id: 'me', name: 'Me', pos: { x: 0, y: 0, z: 0 } });
  render(<ArrivalBubble store={store} selfId="me" />);
  return actions;
};

describe('ArrivalBubble', () => {
  it('announces a join with +1 for about 4s, once per arrival', () => {
    const actions = setup();
    vi.useFakeTimers();
    act(() => actions.upsertPlayer({ id: 'bob', name: 'Bob', pos: { x: 2, y: 0, z: 0 } }));
    expect(screen.getByText('+1 Bob')).toBeTruthy();
    act(() => vi.advanceTimersByTime(3900));
    expect(screen.getByText('+1 Bob')).toBeTruthy();
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByText(/\+1/)).toBeNull();

    act(() => actions.upsertPlayer({ id: 'bob', pos: { x: 3, y: 0, z: 0 } }));
    expect(screen.queryByText(/\+1/)).toBeNull();
  });

  it('waits for a joining player to be named before announcing them', () => {
    const actions = setup();
    act(() => actions.upsertPlayer({ id: 'cat', name: '', pos: { x: 1, y: 0, z: 0 } }));
    expect(screen.queryByText(/\+1/)).toBeNull();
    act(() => actions.upsertPlayer({ id: 'cat', name: ' Cat Jones' }));
    expect(screen.getByText('+1 Cat')).toBeTruthy();
  });

  it('shows a toast with the first name when asked to', () => {
    const store = createStore({ selfId: 'me', officeId: 'o' });
    const actions = createActions(store, createBus());
    render(<ArrivalBubble store={store} selfId="me" toast />);
    act(() => actions.upsertPlayer({ id: 'ann', name: 'Ann Lee', pos: { x: 1, y: 0, z: 0 } }));
    expect(screen.getByRole('status').textContent).toBe('Ann came in');
  });
});
