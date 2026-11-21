// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore } from '@officexr/sdk';
import { SETTINGS_PAGES } from '../../room/Settings';
import { SettingsSheet, type SettingsSheetProps } from './SettingsSheet';

afterEach(cleanup);

function setup(over: Partial<SettingsSheetProps> = {}) {
  const store = createStore({ selfId: 'me#t0', officeId: 'o' });
  const props: SettingsSheetProps = {
    store,
    portrait: false,
    page: null,
    pages: Object.fromEntries(SETTINGS_PAGES.map((id) => [id, <p key={id}>{id} body</p>])) as SettingsSheetProps['pages'],
    canBuild: true,
    onPage: vi.fn(),
    onBack: vi.fn(),
    onClose: vi.fn(),
    onInvite: vi.fn(),
    onBuild: vi.fn(),
    onSwitchOffice: vi.fn(),
    onSignOut: vi.fn(() => Promise.resolve()),
    ...over,
  };
  render(<SettingsSheet {...props} />);
  return props;
}

const rows = () => screen.getAllByRole('button').map((b) => b.textContent);

describe('SettingsSheet top level', () => {
  it('lists the office actions, the five sections and Sign out under one Menu title', () => {
    setup();
    expect(screen.getByRole('dialog', { name: 'Menu' })).toBeTruthy();
    expect(rows()).toEqual([
      '',
      'Invite peopleCopy or share the link',
      'BuildPlace props',
      'Switch office',
      'ProfileLook and status',
      'ControlsView, motion, appearance',
      'AlertsPing sound and notifications',
      'OfficeName, map, studio',
      'HelpHow to move, hints',
      'Sign out',
    ]);
    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.getByText('Available')).toBeTruthy();
  });

  it('hides Build when nothing can be placed', () => {
    setup({ canBuild: false });
    expect(screen.queryByRole('button', { name: /^Build/ })).toBeNull();
  });

  it('runs the office actions and opens a section', () => {
    const p = setup();
    fireEvent.click(screen.getByRole('button', { name: /^Invite people/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Build/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Switch office/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Alerts/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Close menu' }));
    expect(p.onInvite).toHaveBeenCalled();
    expect(p.onBuild).toHaveBeenCalled();
    expect(p.onSwitchOffice).toHaveBeenCalled();
    expect(p.onPage).toHaveBeenCalledWith('alerts');
    expect(p.onClose).toHaveBeenCalled();
  });

  it('shows the sign-out error', async () => {
    setup({ onSignOut: () => Promise.reject(new Error('Logout broke')) });
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Logout broke');
  });

  it('moves between rows with the arrow keys', () => {
    setup();
    const first = screen.getByRole('button', { name: /^Invite people/ });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Build/ }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(first);
  });

  it('shows Focus as the status when the person has set it', async () => {
    const store = createStore({ selfId: 'me#t0', officeId: 'o' });
    store.setState((s) => ({ ...s, players: { ...s.players, 'me#t0': { ...s.players['me#t0']!, focus: true } } }));
    setup({ store });
    await waitFor(() => expect(screen.getByText('Focus')).toBeTruthy());
  });
});

describe('SettingsSheet pages', () => {
  it('shows the section with a back arrow and its own title', () => {
    const p = setup({ page: 'help' });
    expect(screen.getByRole('dialog', { name: 'Help' })).toBeTruthy();
    expect(screen.getByText('help body')).toBeTruthy();
    expect(screen.queryByText('Sign out')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(p.onBack).toHaveBeenCalled();
  });

  it('uses a bottom sheet with a back arrow in portrait', () => {
    setup({ portrait: true, page: 'office' });
    const dialog = screen.getByRole('dialog', { name: 'Office' });
    expect(dialog.hasAttribute('data-hud-modal')).toBe(true);
    expect(within(dialog).getByRole('button', { name: 'Back' })).toBeTruthy();
  });

  it('goes back on Escape', () => {
    const p = setup({ page: 'office' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(p.onBack).toHaveBeenCalledTimes(1);
  });
});
