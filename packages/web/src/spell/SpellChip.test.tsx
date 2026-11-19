// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createActions, createBus, createStore } from '@officexr/sdk';
import { SpellChip } from './SpellChip';

afterEach(cleanup);

function setup() {
  const store = createStore({ selfId: 'me', officeId: 'o' });
  const actions = createActions(store, createBus());
  actions.upsertPlayer({ id: 'me', name: 'Me' });
  render(<SpellChip store={store} actions={actions} selfId="me" />);
  return { store, actions };
}

describe('SpellChip', () => {
  it('shows nothing until the wand is in hand', () => {
    const { actions } = setup();
    expect(screen.queryByRole('group', { name: 'Wand spell' })).toBeNull();
    act(() => actions.setSelfHeld('wand', 'stand-1'));
    expect(screen.getByRole('group', { name: 'Wand spell' })).toBeTruthy();
    act(() => actions.setSelfHeld(null));
    expect(screen.queryByRole('group', { name: 'Wand spell' })).toBeNull();
  });

  it('marks the fireball as the first spell and picks another on a click', () => {
    const { actions, store } = setup();
    act(() => actions.setSelfHeld('wand', 'stand-1'));
    expect(screen.getByRole('button', { name: /Fireball/ }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /Shrink/ }));
    expect(store.getState().selectedSpell).toBe('shrink');
    expect(screen.getByRole('button', { name: /Shrink/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('numbers the spells in hotkey order', () => {
    const { actions } = setup();
    act(() => actions.setSelfHeld('wand', 'stand-1'));
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['1Fireball', '2Levitate', '3Shrink', '4Color burst']);
  });
});
