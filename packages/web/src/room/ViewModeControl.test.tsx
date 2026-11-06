// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ViewModeControl } from './ViewModeControl';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('ViewModeControl', () => {
  it('stores the other mode and reloads', () => {
    const reload = vi.fn();
    render(<ViewModeControl mode="3d" reload={reload} />);
    expect(screen.getByRole('radio', { name: '3D' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: '2D' }));
    expect(localStorage.getItem('officexr:viewMode')).toBe('2d');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('does nothing when the current mode is chosen again', () => {
    const reload = vi.fn();
    render(<ViewModeControl mode="2d" reload={reload} />);
    fireEvent.click(screen.getByRole('radio', { name: '2D' }));
    expect(reload).not.toHaveBeenCalled();
  });
});
