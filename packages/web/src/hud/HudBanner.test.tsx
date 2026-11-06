// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { HudBanner } from './HudBanner';

afterEach(cleanup);

it('dismisses through its button', () => {
  const onDismiss = vi.fn();
  render(<HudBanner message="Could not save" onDismiss={onDismiss} />);
  expect(screen.getByRole('alert').textContent).toContain('Could not save');
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

it('has no dismiss button without onDismiss', () => {
  render(<HudBanner message="Replaced" />);
  expect(screen.queryByRole('button')).toBeNull();
});
