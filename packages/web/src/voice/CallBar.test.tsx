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
  it('collapses to the mic toggle and the people toggle on a coarse pointer', () => {
    stubPointer(true);
    setup();
    expect(screen.getByRole('button', { name: /microphone/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /share/i })).toBeNull();
    const people = screen.getByLabelText('In call, 0').closest('button')!;
    fireEvent.click(people);
    expect(people.getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps the share toggle on a fine pointer', () => {
    setup();
    expect(screen.getByRole('button', { name: /share/i })).toBeTruthy();
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
