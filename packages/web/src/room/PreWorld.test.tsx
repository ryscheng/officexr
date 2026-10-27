// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreWorld } from './PreWorld';
import type { JoinCheck } from './useJoinCheck';
import type { OfficeSession } from './useOfficeSession';

afterEach(cleanup);

const show = (join: JoinCheck, session: OfficeSession) =>
  render(<PreWorld title="HQ" join={join} session={session} onJoin={vi.fn()} onCancel={vi.fn()} />);

describe('PreWorld', () => {
  it('shows the session check step', () => {
    show('checking', { type: 'connecting' });
    expect(screen.getByRole('status').textContent).toBe('Checking your session…');
    expect(screen.getByText('HQ')).toBeTruthy();
  });

  it('shows the connecting step once joining', () => {
    show('go', { type: 'connecting' });
    expect(screen.getByRole('status').textContent).toBe('Connecting…');
  });

  it('shows a connect error on the screen with Reload', () => {
    show('go', { type: 'error', message: 'Realtime server not reachable: x' });
    expect(screen.getByRole('alert').textContent).toBe('Realtime server not reachable: x');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });

  it('keeps the screen under the join prompt', () => {
    show('prompt', { type: 'connecting' });
    expect(screen.getByTestId('world-loading')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Join anyway' })).toBeTruthy();
  });

  it('renders no screen once the world takes over', () => {
    show('go', { type: 'replaced' });
    expect(screen.queryByTestId('world-loading')).toBeNull();
  });
});
