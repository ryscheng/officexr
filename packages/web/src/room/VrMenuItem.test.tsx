// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useWorldFocus } from '@officexr/world/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomMenu } from './RoomMenu';
import { VrMenuItem, type VrSessionStore } from './VrMenuItem';

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

function renderMenu(props: { supported: boolean; store: VrSessionStore; onError?: (message: string) => void }) {
  render(
    <RoomMenu>
      <VrMenuItem onError={() => {}} {...props} />
    </RoomMenu>,
  );
  openMenu();
}

const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Menu' }));

describe('VrMenuItem', () => {
  it('is hidden when immersive VR is not supported', () => {
    renderMenu({ supported: false, store: fakeStore().store });
    expect(screen.queryByRole('button', { name: /VR/ })).toBeNull();
  });

  it('enters VR, then offers Exit VR while the session lasts', () => {
    const { store, setSession } = fakeStore(vi.fn(() => Promise.resolve()));
    renderMenu({ supported: true, store });
    fireEvent.click(screen.getByRole('button', { name: 'Enter VR' }));
    expect(store.enterVR).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: /VR/ })).toBeNull();

    const end = vi.fn(() => Promise.resolve());
    act(() => setSession({ end }));
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Exit VR' }));
    expect(end).toHaveBeenCalledOnce();

    act(() => setSession(undefined));
    openMenu();
    expect(screen.getByRole('button', { name: 'Enter VR' })).toBeTruthy();
  });

  it('hands keyboard control back to the world once the session starts', async () => {
    function Focused() {
      return <output>{String(useWorldFocus())}</output>;
    }
    render(<Focused />);
    renderMenu({ supported: true, store: fakeStore().store });
    // Using the menu, a studio panel, released the world.
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Enter VR' }));
    expect(screen.getByRole('status').textContent).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Enter VR' }));
    await vi.waitFor(() => expect(screen.getByRole('status').textContent).toBe('true'));
  });

  it('reports a failed session request instead of rejecting unhandled', async () => {
    const onError = vi.fn();
    const { store } = fakeStore(() => Promise.reject(new Error('NotSupportedError')));
    renderMenu({ supported: true, store, onError });
    fireEvent.click(screen.getByRole('button', { name: 'Enter VR' }));
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('Could not start VR.'));
  });
});
