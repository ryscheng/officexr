// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { useWorldFocus } from '@officexr/world/react';
import type { CameraMode } from '@officexr/world/renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CameraModeControl } from './CameraModeControl';
import { KeybindsTab } from './KeybindsTab';
import { useSettings, type SettingsAction, type SettingsTab } from './Settings';
import { openSettings, SettingsHarness } from './settingsHarness';
import { useShortcutsHotkey } from './useShortcutsHotkey';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // jsdom doesn't implement it, so a test defines it.
  delete (document as Partial<Document>).exitPointerLock;
});

const settingsDialog = () => screen.queryByRole('dialog', { name: 'Settings HQ' });

function Hotkey() {
  const { open } = useSettings();
  useShortcutsHotkey(() => open('keybinds'));
  return null;
}

function Focus() {
  return <output>{String(useWorldFocus())}</output>;
}

function Harness({
  onCameraModeChange = () => {},
  actions,
}: {
  onCameraModeChange?: (mode: CameraMode) => void;
  actions?: SettingsAction[];
}) {
  const [cameraMode, setCameraMode] = useState<CameraMode>('fixed');
  const tabs: SettingsTab[] = [
    { id: 'controls', label: 'Controls', content: <p>View row</p> },
    { id: 'keybinds', label: 'Keybinds', content: <KeybindsTab /> },
    {
      id: 'controls',
      label: 'Controls',
      content: (
        <CameraModeControl
          value={cameraMode}
          onChange={(mode) => {
            setCameraMode(mode);
            onCameraModeChange(mode);
          }}
        />
      ),
    },
  ];
  return (
    <>
      <input aria-label="Chat" />
      <Focus />
      <SettingsHarness tabs={tabs} actions={actions}>
        <Hotkey />
      </SettingsHarness>
    </>
  );
}

describe('SettingsModal', () => {
  it('opens from the gear on the Controls tab and closes on Escape, Close and Back to office', () => {
    render(<Harness />);
    expect(settingsDialog()).toBeNull();
    for (const closeIt of [
      () => fireEvent.keyDown(settingsDialog()!, { key: 'Escape' }),
      () => fireEvent.click(screen.getByRole('button', { name: 'Close' })),
      () => fireEvent.click(screen.getByRole('button', { name: 'Back to office' })),
    ]) {
      openSettings();
      expect(screen.getByRole('tab', { name: 'Controls' }).getAttribute('aria-selected')).toBe('true');
      closeIt();
      expect(settingsDialog()).toBeNull();
    }
  });

  it('merges tabs that share an id, in order', () => {
    render(<Harness />);
    openSettings();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Controls', 'Keybinds']);
    const panel = screen.getByRole('tabpanel');
    expect(panel.textContent).toMatch(/^View row/);
    expect(screen.getByRole('radiogroup', { name: 'Camera' })).toBeTruthy();
  });

  it('checks the current camera mode and reports a selection, keeping Settings open', () => {
    const onCameraModeChange = vi.fn();
    render(<Harness onCameraModeChange={onCameraModeChange} />);
    openSettings();
    expect(screen.getAllByRole('radio').map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true']);
    fireEvent.click(screen.getByRole('radio', { name: 'Third person' }));
    expect(onCameraModeChange).toHaveBeenCalledWith('third-person');
    expect(screen.getByRole('radio', { name: 'Third person' }).getAttribute('aria-checked')).toBe('true');
    expect(settingsDialog()).toBeTruthy();
  });

  it('runs an action with a close that dismisses Settings', () => {
    const onSelect = vi.fn();
    render(
      <Harness
        actions={[
          {
            id: 'a',
            render: (close) => (
              <button
                onClick={() => {
                  close();
                  onSelect();
                }}
              >
                Act
              </button>
            ),
          },
        ]}
      />,
    );
    openSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Act' }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(settingsDialog()).toBeNull();
  });

  it('releases pointer lock on open', () => {
    const exitPointerLock = vi.fn();
    Object.defineProperty(document, 'exitPointerLock', { value: exitPointerLock, configurable: true, writable: true });
    render(<Harness />);
    openSettings();
    expect(exitPointerLock).toHaveBeenCalledOnce();
  });

  it('keeps its Escape from window-level Escape handlers', () => {
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    render(<Harness />);
    openSettings();
    fireEvent.keyDown(settingsDialog()!, { key: 'Escape' });
    window.removeEventListener('keydown', onWindowKey);
    expect(settingsDialog()).toBeNull();
    expect(onWindowKey).not.toHaveBeenCalled();
  });

  it('keeps a backdrop pointerdown from reaching elements beneath it', () => {
    const onPointerDown = vi.fn();
    render(
      <div onPointerDown={onPointerDown}>
        <Harness />
      </div>,
    );
    openSettings();
    onPointerDown.mockClear();
    fireEvent.pointerDown(settingsDialog()!.parentElement!);
    expect(onPointerDown).not.toHaveBeenCalled();
  });

  it('owns the keyboard while open and hands it back to the world on close', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Settings' }).closest('[data-studio-panel]')).toBeTruthy();
    fireEvent.keyDown(window, { key: '?' });
    expect(settingsDialog()!.closest('[data-studio-panel]')).toBeTruthy();
    // Opening focuses the dialog, a studio panel, which releases the world.
    expect(screen.getByRole('status').textContent).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('status').textContent).toBe('true');
  });
});

describe('shortcuts hotkey', () => {
  it('? opens the Keybinds tab, which lists ? itself as a keycap', () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: '?' });
    expect(screen.getByRole('tab', { name: 'Keybinds' }).getAttribute('aria-selected')).toBe('true');
    const panel = screen.getByRole('tabpanel');
    expect(panel.textContent).toContain('Show keyboard shortcuts');
    expect([...panel.querySelectorAll('kbd')].map((k) => k.textContent)).toContain('?');
  });

  it('ignores ? typed into an input', () => {
    render(<Harness />);
    fireEvent.keyDown(screen.getByLabelText('Chat'), { key: '?' });
    expect(settingsDialog()).toBeNull();
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
