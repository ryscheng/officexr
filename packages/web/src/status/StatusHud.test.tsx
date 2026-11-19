// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createActions, createBus, createStore, EMOTE_IDS, EMOTE_INFO, STATUS_TEXT_MAX, type EmoteId } from '@officexr/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmoteMenu } from './EmoteMenu';
import { SelfStatusProvider } from './SelfStatusProvider';
import { StatusMenu } from './StatusMenu';

beforeEach(() => {
  // jsdom lacks it; Radix's Switch measures its form-mirroring input with one.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
};

function setup() {
  const store = createStore({ selfId: 'me#t0', officeId: 'o' });
  const actions = createActions(store, createBus());
  actions.upsertPlayer({ id: 'me#t0', name: 'Me' });
  const sendEmote = vi.fn<(emote: EmoteId) => void>();
  const storage = memory();
  render(
    <SelfStatusProvider store={store} actions={actions} sync={{ sendEmote }} selfId="me#t0" storage={storage}>
      <StatusMenu />
      <EmoteMenu />
    </SelfStatusProvider>,
  );
  const me = () => store.getState().players['me#t0']!;
  return { me, sendEmote, storage };
}

describe('StatusMenu', () => {
  it('opens from the chip, saves the typed text and an emoji, and closes', () => {
    const { me, storage } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Set a status' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use 🎧' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Status text' }), { target: { value: 'In a call' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(me()).toMatchObject({ statusText: 'In a call', statusEmoji: '🎧' });
    expect(JSON.parse(storage.data.get('officexr:status')!)).toMatchObject({ text: 'In a call', emoji: '🎧' });
    expect(screen.queryByRole('textbox', { name: 'Status text' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Status: In a call' })).toBeTruthy();
  });

  it('limits the text field to the status length', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Set a status' }));
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Status text' }).maxLength).toBe(STATUS_TEXT_MAX);
  });

  it('turns focus mode on from the switch and shows it on the chip', () => {
    const { me } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Set a status' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Focus mode' }));
    expect(me().focus).toBe(true);
    expect(screen.getByRole('button', { name: 'Status: focus mode' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('clears the status', () => {
    const { me } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Set a status' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use 🚀' }));
    expect(me().statusEmoji).toBe('🚀');
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(me().statusEmoji).toBeNull();
    expect(me().statusText).toBeNull();
  });
});

describe('EmoteMenu', () => {
  it('lists every emote and sends the one you pick, then closes', () => {
    const { sendEmote } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Emotes' }));
    const list = screen.getByRole('list', { name: 'Emotes' });
    expect(within(list).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(
      EMOTE_IDS.map((id) => EMOTE_INFO[id].label),
    );
    fireEvent.click(within(list).getByRole('button', { name: 'Clap' }));
    expect(sendEmote).toHaveBeenCalledExactlyOnceWith('clap');
    expect(screen.queryByRole('list', { name: 'Emotes' })).toBeNull();
  });

  it('toggles the raised hand and names the next action', () => {
    const { me } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Raise your hand' }));
    expect(me().handRaised).toBe(true);
    const lower = screen.getByRole('button', { name: 'Lower your hand' });
    expect(lower.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(lower);
    expect(me().handRaised).toBe(false);
  });

  it('opens with the R key', () => {
    setup();
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true })));
    expect(screen.getByRole('list', { name: 'Emotes' })).toBeTruthy();
  });
});

describe('without a provider', () => {
  it('renders nothing', () => {
    const { container } = render(
      <>
        <StatusMenu />
        <EmoteMenu />
      </>,
    );
    expect(container.textContent).toBe('');
  });
});
