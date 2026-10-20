// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { createActions, createBus, createStore } from '@officexr/sdk';
import { createMultiClientHarness } from '@officexr/sdk/test-harness';
import { useWorldFocus } from '@officexr/world/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ChatPanel } from './ChatPanel';

afterEach(cleanup);

describe('chat between clients', () => {
  it('delivers a message to the other client with the sender name', async () => {
    const harness = createMultiClientHarness();
    const alice = await harness.add('alice');
    const bob = await harness.add('bob');
    alice.actions.upsertPlayer({ id: 'alice', name: 'Alice' });
    bob.actions.upsertPlayer({ id: 'alice', name: 'Alice' });

    alice.actions.appendChat({ id: 'm1', authorId: 'alice', text: 'hello', t: 1 });

    const received = bob.store.getState().chat;
    expect(received.map((m) => m.text)).toEqual(['hello']);
    expect(bob.store.getState().players[received[0].authorId]?.name).toBe('Alice');
  });
});

describe('ChatPanel input', () => {
  const setup = () => {
    const store = createStore({ selfId: 'me', officeId: 'o' });
    const actions = createActions(store, createBus());
    const focus = renderHook(() => useWorldFocus());
    render(<ChatPanel store={store} actions={actions} selfId="me" />);
    return { store, focus };
  };

  it('Enter opens the input and releases the world keyboard; Enter sends', () => {
    const { store, focus } = setup();
    expect(focus.result.current).toBe(true);

    act(() => {
      fireEvent.keyDown(window, { key: 'Enter' });
    });
    const input = screen.getByPlaceholderText('Type a message...') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(focus.result.current).toBe(false);

    fireEvent.change(input, { target: { value: 'hi there' } });
    fireEvent.keyDown(input, { key: 'w' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(store.getState().chat.map((m) => [m.authorId, m.text])).toEqual([['me', 'hi there']]);
    expect(input.value).toBe('');
  });

  it('Escape closes the panel', () => {
    setup();
    act(() => {
      fireEvent.keyDown(window, { key: 'Enter' });
    });
    fireEvent.keyDown(screen.getByPlaceholderText('Type a message...'), { key: 'Escape' });
    expect(screen.queryByPlaceholderText('Type a message...')).toBeNull();
  });
});
