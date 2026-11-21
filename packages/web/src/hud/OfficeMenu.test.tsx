// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MenuPopover } from './OfficeHud';

afterEach(cleanup);

const setup = (onSignOut: () => Promise<void> = () => Promise.resolve()) => {
  const actions = { onInvite: vi.fn(), onPeople: vi.fn(), onSettings: vi.fn(), onSwitchOffice: vi.fn(), onSignOut: vi.fn(onSignOut) };
  render(<MenuPopover portrait={false} onClose={() => {}} {...actions} />);
  return actions;
};

describe('office menu', () => {
  it('lists Invite people, Switch office and Sign out with the existing items', () => {
    setup();
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Invite people', 'People here', 'Settings', 'Switch office', 'Sign out']);
  });

  it('runs each item', () => {
    const actions = setup();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Invite people' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Switch office' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(actions.onInvite).toHaveBeenCalled();
    expect(actions.onSwitchOffice).toHaveBeenCalled();
    expect(actions.onSignOut).toHaveBeenCalled();
  });

  it('shows the error when sign-out fails', async () => {
    setup(() => Promise.reject(new Error('Logout broke')));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Logout broke');
  });

  it('shows the phone menu as a sheet with the same items', () => {
    render(<MenuPopover portrait onClose={() => {}} onInvite={() => {}} onPeople={() => {}} onSettings={() => {}} onSwitchOffice={() => {}} onSignOut={() => Promise.resolve()} />);
    expect(screen.getByRole('dialog', { name: 'Menu' })).toBeTruthy();
    expect(screen.getAllByRole('menuitem')).toHaveLength(5);
  });
});
