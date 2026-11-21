// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createActions, createBus, createStore } from '@officexr/sdk';
import { StatusSection } from './StatusSection';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const SELF = 'me#t0';

function setup() {
  const store = createStore({ selfId: SELF, officeId: 'o' });
  const actions = createActions(store, createBus());
  actions.upsertPlayer({ id: SELF, name: 'Me' });
  render(<StatusSection store={store} actions={actions} selfId={SELF} />);
  return store;
}

describe('StatusSection', () => {
  it('sets and clears Focus from the segmented control', () => {
    const store = setup();
    expect(screen.getByRole('radio', { name: 'Available' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Focus' }));
    expect(store.getState().players[SELF]?.focus).toBe(true);
    expect(screen.getByRole('radio', { name: 'Focus' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Available' }));
    expect(store.getState().players[SELF]?.focus).toBe(false);
  });

  it('raises and lowers the hand', () => {
    const store = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Raise hand' }));
    expect(store.getState().players[SELF]?.handRaised).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Lower hand' }));
    expect(store.getState().players[SELF]?.handRaised).toBe(false);
  });
});
