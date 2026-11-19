// @vitest-environment jsdom
import { act, cleanup, render, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createActions, createBus, createStore, type EmoteId, type GameEvent } from '@officexr/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMOTE_COOLDOWN_MS, SelfStatusProvider, useStatusHud } from './SelfStatusProvider';

afterEach(cleanup);

const memory = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
};

function setup(saved: Record<string, string> = {}) {
  const store = createStore({ selfId: 'me#t0', officeId: 'o' });
  const bus = createBus();
  const actions = createActions(store, bus);
  actions.upsertPlayer({ id: 'me#t0', name: 'Me' });
  const sendEmote = vi.fn<(emote: EmoteId) => void>();
  const storage = memory(saved);
  let now = 0;
  const clock = () => now;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SelfStatusProvider store={store} actions={actions} sync={{ sendEmote }} selfId="me#t0" storage={storage} clock={clock}>
      {children}
    </SelfStatusProvider>
  );
  const view = renderHook(() => useStatusHud()!, { wrapper });
  const me = () => store.getState().players['me#t0']!;
  return { store, bus, view, storage, sendEmote, me, advance: (ms: number) => (now += ms) };
}

describe('SelfStatusProvider', () => {
  it('applies the saved status on mount', () => {
    const { me, view } = setup({ 'officexr:status': JSON.stringify({ text: 'Back at 3', emoji: '🍽️', focus: true }) });
    expect(me()).toMatchObject({ statusText: 'Back at 3', statusEmoji: '🍽️', focus: true });
    expect(view.result.current).toMatchObject({ text: 'Back at 3', emoji: '🍽️', focus: true });
  });

  it('puts an edited status in the store and saves it', () => {
    const { me, view, storage } = setup();
    act(() => view.result.current.setStatus({ text: '  Pairing  ', emoji: '🎧' }));
    expect(me()).toMatchObject({ statusText: 'Pairing', statusEmoji: '🎧' });
    expect(JSON.parse(storage.data.get('officexr:status')!)).toEqual({ text: 'Pairing', emoji: '🎧', focus: false });
  });

  it('toggles focus and saves it', () => {
    const { me, view, storage } = setup();
    act(() => view.result.current.toggleFocus());
    expect(me().focus).toBe(true);
    expect(JSON.parse(storage.data.get('officexr:status')!).focus).toBe(true);
    act(() => view.result.current.toggleFocus());
    expect(me().focus).toBe(false);
  });

  it('raises and lowers the hand without saving it', () => {
    const { me, view, storage } = setup();
    act(() => view.result.current.toggleHand());
    expect(me().handRaised).toBe(true);
    expect(view.result.current.handRaised).toBe(true);
    act(() => view.result.current.toggleHand());
    expect(me().handRaised).toBe(false);
    expect(storage.data.has('officexr:status')).toBe(false);
  });

  it('sends an emote to peers and shows it locally, once per cooldown', () => {
    const { bus, view, sendEmote, advance } = setup();
    const local: GameEvent[] = [];
    bus.on('emote:received', (e) => local.push(e));

    act(() => view.result.current.sendEmote('party'));
    act(() => view.result.current.sendEmote('heart'));
    expect(sendEmote.mock.calls).toEqual([['party']]);
    expect(local).toEqual([{ kind: 'emote:received', fromId: 'me#t0', emote: 'party', at: 0 }]);

    advance(EMOTE_COOLDOWN_MS);
    act(() => view.result.current.sendEmote('heart'));
    expect(sendEmote.mock.calls).toEqual([['party'], ['heart']]);
  });

  describe('keys', () => {
    const press = (init: KeyboardEventInit, target: EventTarget = window) =>
      act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })));

    it('H raises the hand, R opens the emote picker, Alt+N toggles focus', () => {
      const { me, view } = setup();
      press({ key: 'h' });
      expect(me().handRaised).toBe(true);
      press({ key: 'r' });
      expect(view.result.current.emoteMenuOpen).toBe(true);
      press({ key: 'r' });
      expect(view.result.current.emoteMenuOpen).toBe(false);
      press({ key: 'n', code: 'KeyN', altKey: true });
      expect(me().focus).toBe(true);
    });

    it('ignores typing in a field, chords with Ctrl or Meta, and a held key', () => {
      const { me } = setup();
      const { container } = render(<input aria-label="field" />);
      const input = container.querySelector('input')!;
      input.focus();
      press({ key: 'h' }, input);
      press({ key: 'h', ctrlKey: true });
      press({ key: 'h', metaKey: true });
      expect(me().handRaised ?? false).toBe(false);
      press({ key: 'h' });
      press({ key: 'h', repeat: true });
      expect(me().handRaised).toBe(true);
    });

    it('stands down while a dialog is open', () => {
      const { me } = setup();
      render(<div role="dialog" />);
      press({ key: 'h' });
      expect(me().handRaised ?? false).toBe(false);
    });
  });

  it('is absent outside a provider', () => {
    const { result } = renderHook(() => useStatusHud());
    expect(result.current).toBeNull();
  });
});
