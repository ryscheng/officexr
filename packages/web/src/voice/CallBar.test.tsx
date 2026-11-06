// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createActions, createBus, createStore } from '@officexr/sdk';
import { createViewYaw, PlayControlsProvider, ViewYawProvider } from '@officexr/world/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakePlayControls } from '../hud/fakePlayControls';
import { CallBar } from './CallBar';
import type { JaasVoiceAdapter } from './JaasVoiceAdapter';

const stubPointer = (coarse: boolean) =>
  vi.stubGlobal('matchMedia', () => ({ matches: coarse, addEventListener: () => {}, removeEventListener: () => {} }));

beforeEach(() => stubPointer(false));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const share = { canShare: true, sharing: false, viewing: null };
const voice = {
  onMuteChange: () => () => {},
  isMicMuted: () => false,
  onShareChange: () => () => {},
  getShareState: () => share,
} as unknown as JaasVoiceAdapter;

function setup() {
  const store = createStore({ selfId: 'me', officeId: 'o' });
  const actions = createActions(store, createBus());
  actions.upsertPlayer({ id: 'me', name: 'Me', pos: { x: 0, y: 0, z: 0 } });
  render(
    <PlayControlsProvider controls={fakePlayControls().controls}>
      <ViewYawProvider viewYaw={createViewYaw()}>
        <CallBar store={store} selfId="me" voice={voice} />
      </ViewYawProvider>
    </PlayControlsProvider>,
  );
  return actions;
}

describe('CallBar', () => {
  it('gates the label, share toggle and avatars to a fine pointer and shows the count on a coarse one', () => {
    setup();
    const coarseHidden = (el: Element) => el.closest('.pointer-coarse\\:hidden') !== null;
    expect(coarseHidden(screen.getByRole('button', { name: 'Share screen' }))).toBe(true);
    expect(coarseHidden(screen.getByRole('button', { name: /microphone/ }))).toBe(false);
    const people = screen.getByRole('button', { name: 'In call, 0' });
    expect(coarseHidden(people)).toBe(false);
    expect(people.querySelector('.pointer-coarse\\:inline')?.textContent).toBe('0');
  });

  it('offers screen share in the tray for a coarse pointer', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /In call/ }));
    const shares = screen.getAllByRole('button', { name: 'Share screen' });
    expect(shares).toHaveLength(2);
    expect(shares[0].closest('.pointer-coarse\\:inline-flex')).not.toBeNull();
  });

  it('opens and closes the tray from the toggle and reflects it in aria-expanded', () => {
    setup();
    const toggle = screen.getByRole('button', { name: /In call/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Not in a call', { selector: 'p' })).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Not in a call', { selector: 'p' })).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows Joining call in the tray while connecting', () => {
    const actions = setup();
    fireEvent.click(screen.getByRole('button', { name: /In call/ }));
    act(() => actions.setMyJitsiRoom('room'));
    expect(screen.getByText('Joining call', { selector: 'p' })).toBeTruthy();
  });

  it('closes the tray on Esc', () => {
    setup();
    const toggle = screen.getByRole('button', { name: /In call/ });
    fireEvent.click(toggle);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });
});
