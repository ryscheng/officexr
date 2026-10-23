// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorldLoadingScreen } from './LoadingScreen.tsx';

afterEach(cleanup);

describe('WorldLoadingScreen', () => {
  it('renders the title and puts the step in a status region', () => {
    render(<WorldLoadingScreen title="HQ" step="Connecting…" />);
    expect(screen.getByText('HQ')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Connecting…');
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows a progress bar only when progress is given, clamped to 0-100', () => {
    render(<WorldLoadingScreen step="Loading" progress={140} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
  });

  it('shows the error with a Reload button that calls onReload', () => {
    const onReload = vi.fn();
    render(<WorldLoadingScreen step="Connecting…" error="Server down" onReload={onReload} />);
    expect(screen.getByRole('alert').textContent).toBe('Server down');
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onReload).toHaveBeenCalledOnce();
  });

  it('shows the slow notice and Reload', () => {
    render(<WorldLoadingScreen step="Loading" slow />);
    expect(screen.getByText('This is taking longer than usual.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });
});
