// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { createActions, createBus, createStore } from '@officexr/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { ChatTicker } from './ChatTicker';

afterEach(cleanup);

const setup = (hidden?: string[]) => {
  const store = createStore({ selfId: 'me', officeId: 'o' });
  const actions = createActions(store, createBus());
  actions.upsertPlayer({ id: 'ann@example.test#a', name: 'Ann' });
  render(<ChatTicker store={store} hiddenLogins={hidden && new Set(hidden)} onOpen={() => {}} />);
  return () => act(() => actions.applyRemoteChat({ id: 'm1', authorId: 'ann@example.test#a', text: 'lunch?', t: 1 }));
};

describe('ChatTicker', () => {
  it('shows the latest message with its author', () => {
    setup()();
    expect(screen.getByRole('button', { name: 'New message from Ann, open chat' })).toBeTruthy();
  });

  it('shows nothing when the latest message is from a muted login', () => {
    setup(['ann@example.test'])();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
