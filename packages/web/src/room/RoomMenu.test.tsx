// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { useWorldFocus } from '@officexr/world/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CameraMode } from '@officexr/world/renderer';
import { CameraModeMenuItem } from './CameraModeMenuItem';
import { RoomMenu, RoomMenuItem } from './RoomMenu';
import { ShortcutsDialog } from './ShortcutsDialog';
import { useShortcutsHotkey } from './useShortcutsHotkey';

afterEach(cleanup);

const menuButton = () => screen.getByRole('button', { name: 'Menu' });

function Harness({ onCameraModeChange = () => {} }: { onCameraModeChange?: (mode: CameraMode) => void }) {
  const [cameraMode, setCameraMode] = useState<CameraMode>('fixed');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  useShortcutsHotkey(() => setShortcutsOpen(true));
  return (
    <>
      <input aria-label="Chat" />
      <RoomMenu>
        <CameraModeMenuItem
          value={cameraMode}
          onChange={(mode) => {
            setCameraMode(mode);
            onCameraModeChange(mode);
          }}
        />
        <RoomMenuItem onSelect={() => setShortcutsOpen(true)}>Keyboard shortcuts</RoomMenuItem>
      </RoomMenu>
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
    </>
  );
}

describe('RoomMenu', () => {
  it('opens from the button and closes on outside press and on Escape', () => {
    render(<Harness />);
    expect(menuButton().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(menuButton());
    expect(menuButton().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('group', { name: 'Camera' })).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('group', { name: 'Camera' })).toBeNull();
    fireEvent.click(menuButton());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Camera' })).toBeNull();
  });

  it('stays open for a press inside the panel', () => {
    render(<Harness />);
    fireEvent.click(menuButton());
    fireEvent.pointerDown(screen.getByRole('group', { name: 'Camera' }));
    expect(screen.getByRole('group', { name: 'Camera' })).toBeTruthy();
  });

  it('checks the current camera mode and reports a selection, keeping the menu open', () => {
    const onCameraModeChange = vi.fn();
    render(<Harness onCameraModeChange={onCameraModeChange} />);
    fireEvent.click(menuButton());
    expect(screen.getAllByRole('radio').map((r) => (r as HTMLInputElement).checked)).toEqual([false, false, true]);
    fireEvent.click(screen.getByRole('radio', { name: /Third person/ }));
    expect(onCameraModeChange).toHaveBeenCalledWith('third-person');
    expect((screen.getByRole('radio', { name: /Third person/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('group', { name: 'Camera' })).toBeTruthy();
  });

  it('closes the menu and opens the shortcuts dialog from its item', () => {
    render(<Harness />);
    fireEvent.click(menuButton());
    fireEvent.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    expect(screen.queryByRole('group', { name: 'Camera' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
  });

  it('marks the menu as a studio panel so using it does not drive the avatar', () => {
    render(<Harness />);
    expect(menuButton().closest('[data-studio-panel]')).toBeTruthy();
  });
});

describe('shortcuts dialog', () => {
  it('hands keyboard control back to the world when it closes', () => {
    function Focused() {
      const focused = useWorldFocus();
      const [open, setOpen] = useState(false);
      return (
        <>
          <output>{String(focused)}</output>
          <button onClick={() => setOpen(true)}>open</button>
          {open && <ShortcutsDialog onClose={() => setOpen(false)} />}
        </>
      );
    }
    render(<Focused />);
    fireEvent.click(screen.getByRole('button', { name: 'open' }));
    // Opening focuses the dialog, a studio panel, which releases the world.
    expect(screen.getByRole('status').textContent).toBe('false');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.getByRole('status').textContent).toBe('true');
  });
});

describe('shortcuts hotkey', () => {
  it('? opens the dialog, which lists ? itself, and Escape closes it', () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: '?' });
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(dialog.textContent).toContain('Show keyboard shortcuts');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ignores ? typed into an input', () => {
    render(<Harness />);
    fireEvent.keyDown(screen.getByLabelText('Chat'), { key: '?' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ignores ? while another dialog is open', () => {
    const onOpen = vi.fn();
    function Other() {
      useShortcutsHotkey(onOpen);
      return <div role="dialog" />;
    }
    render(<Other />);
    fireEvent.keyDown(window, { key: '?' });
    expect(onOpen).not.toHaveBeenCalled();
  });
});
