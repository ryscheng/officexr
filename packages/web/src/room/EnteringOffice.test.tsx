// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnteringOffice } from './EnteringOffice';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const show = (stage: 1 | 2 | 3 | 4, name?: string) =>
  render(
    <MemoryRouter>
      <EnteringOffice stage={stage} name={name} />
    </MemoryRouter>,
  );

describe('EnteringOffice', () => {
  it('opens with a neutral title before the office name is known', () => {
    show(1);
    expect(screen.getByText('Opening your office')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Step 1 of 4: checking your sign-in');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('25');
  });

  it('shows Back to offices only after 8 seconds on a step', () => {
    show(2, 'HQ');
    expect(screen.queryByRole('link', { name: 'Back to offices' })).toBeNull();
    act(() => vi.advanceTimersByTime(8_000));
    expect(screen.getByRole('alert').textContent).toContain('This is taking longer than usual.');
    expect(screen.getByRole('link', { name: 'Back to offices' }).getAttribute('href')).toBe('/');
  });
});
