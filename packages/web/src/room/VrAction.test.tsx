// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useWorldFocus } from '@officexr/world/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openSettings, SettingsHarness } from './settingsHarness';
import { vrActions, type VrSessionStore } from './VrAction';

afterEach(cleanup);

function fakeStore(enterVR: () => Promise<unknown> = () => Promise.resolve()) {
  let session: { end: () => Promise<void> } | undefined;
  const listeners = new Set<() => void>();
  const setSession = (next: typeof session) => {
    session = next;
    listeners.forEach((l) => l());
  };
  const store: VrSessionStore = {
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    getState: () => ({ session }),
    enterVR,
  };
  return { store, setSession };
}

function renderSettings({
  store,
  supported = true,
  onError = () => {},
}: {
  store: VrSessionStore;
  supported?: boolean;
  onError?: (message: string) => void;
}) {
  render(<SettingsHarness actions={vrActions(store, supported, onError)} />);
  openSettings();
}

describe('vrActions', () => {
  it('offers nothing when immersive VR is not supported', () => {
    renderSettings({ supported: false, store: fakeStore().store });
    expect(screen.queryByRole('button', { name: /VR/ })).toBeNull();
  });

  it('enters VR and closes Settings, then offers Exit VR while the session lasts', () => {
    const { store, setSession } = fakeStore(vi.fn(() => Promise.resolve()));
    renderSettings({ store });
    fireEvent.click(screen.getByRole('button', { name: 'Enter VR' }));
    expect(store.enterVR).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();

    const end = vi.fn(() => Promise.resolve());
    act(() => setSession({ end }));
    openSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Exit VR' }));
    expect(end).toHaveBeenCalledOnce();

    act(() => setSession(undefined));
    openSettings();
    expect(screen.getByRole('button', { name: 'Enter VR' })).toBeTruthy();
  });

  it('hands keyboard control back to the world', () => {
    function Focused() {
      return <output>{String(useWorldFocus())}</output>;
    }
    render(<Focused />);
    renderSettings({ store: fakeStore().store });
    // Using Settings, a studio panel, released the world.
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Enter VR' }));
    expect(screen.getByRole('status').textContent).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Enter VR' }));
    expect(screen.getByRole('status').textContent).toBe('true');
  });

  it('reports a failed session request instead of rejecting unhandled', async () => {
    const onError = vi.fn();
    const { store } = fakeStore(() => Promise.reject(new Error('NotSupportedError')));
    renderSettings({ store, onError });
    fireEvent.click(screen.getByRole('button', { name: 'Enter VR' }));
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('Could not start VR.'));
  });
});
