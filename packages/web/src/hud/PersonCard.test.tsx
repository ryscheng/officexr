// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PersonCard, type PersonCardProps } from './PersonCard';

afterEach(cleanup);

const row: PersonCardProps['row'] = { type: 'peer', id: 'ana#t1', name: 'Ana Ruiz', label: 'Ana Ruiz', status: 'available', distanceM: 20, bearingDeg: 0 };
const props = (over: Partial<PersonCardProps> = {}): PersonCardProps => ({
  row,
  now: 0,
  offline: false,
  muted: false,
  pingCoolingDown: false,
  compact: false,
  onGo: vi.fn(),
  onWave: vi.fn(),
  onToggleMute: vi.fn(),
  onPing: vi.fn(),
  ...over,
});
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

describe('PersonCard far actions', () => {
  it('waves at a free person', () => {
    const p = props();
    render(<PersonCard {...p} />);
    fireEvent.click(button('Wave'));
    expect(p.onWave).toHaveBeenCalledTimes(1);
  });

  it('disables Wave and says why when the person is busy', () => {
    render(<PersonCard {...props({ busyReason: 'Ana is in a call' })} />);
    expect(button('Wave').disabled).toBe(true);
    expect(screen.getByText('Ana is in a call')).toBeTruthy();
  });

  it('offers Invite to talk only from inside a call, and sends it once', () => {
    const { rerender } = render(<PersonCard {...props()} />);
    expect(screen.queryByRole('button', { name: 'Invite to talk' })).toBeNull();
    const p = props({ canInvite: true, onInviteToTalk: vi.fn() });
    rerender(<PersonCard {...p} />);
    fireEvent.click(button('Invite to talk'));
    expect(p.onInviteToTalk).toHaveBeenCalledTimes(1);
    rerender(<PersonCard {...props({ canInvite: true, inviteCoolingDown: true })} />);
    expect(button('Invited').disabled).toBe(true);
  });
});
