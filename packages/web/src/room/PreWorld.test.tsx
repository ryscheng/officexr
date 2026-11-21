// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreWorld } from './PreWorld';
import type { JoinCheck } from './useJoinCheck';
import type { OfficeSession } from './useOfficeSession';

afterEach(cleanup);

const show = (join: JoinCheck, session: OfficeSession) =>
  render(<PreWorld title="HQ" join={join} session={session} onJoin={vi.fn()} onRetry={vi.fn()} />);

describe('PreWorld', () => {
  it.each<JoinCheck>(['checking', 'go'])('shows step 3 of 4 with the office name while the join is %s', (join) => {
    show(join, { type: 'connecting' });
    expect(screen.getByRole('status').textContent).toBe('Step 3 of 4: joining the room');
    expect(screen.getByText('Opening HQ')).toBeTruthy();
    expect(screen.getByText('Then: loading the 3D view')).toBeTruthy();
  });

  it('shows a connect error as a plain cause with Try again and the raw text under Details', () => {
    const onRetry = vi.fn();
    render(<PreWorld title="HQ" join="go" session={{ type: 'error', message: 'Realtime server not reachable: x' }} onJoin={vi.fn()} onRetry={onRetry} />);
    expect(screen.getByRole('alert').textContent).toBe('We can not reach the office');
    expect(screen.getByText('Details').closest('details')!.textContent).toContain('Realtime server not reachable: x');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByRole('link', { name: 'Back to offices' })).toBeTruthy();
  });

  it('offers Use this window once another window took the office', () => {
    const onRetry = vi.fn();
    render(<PreWorld title="HQ" join="go" session={{ type: 'replaced' }} onJoin={vi.fn()} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use this window' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('keeps the loading screen under the join prompt', () => {
    show('prompt', { type: 'connecting' });
    expect(screen.getByTestId('world-loading')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use this window' })).toBeTruthy();
  });
});
