// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlayView3dBoundary } from './PlayView3dBoundary';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

function Boom(): never {
  throw new Error('model 404');
}

function renderCrashed(reload = vi.fn()) {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  render(
    <PlayView3dBoundary reload={reload}>
      <Boom />
    </PlayView3dBoundary>,
  );
  return reload;
}

describe('PlayView3dBoundary', () => {
  it('shows the error and leaves the stored view alone', () => {
    renderCrashed();
    expect(screen.getByText('model 404')).toBeTruthy();
    expect(localStorage.getItem('officexr:viewMode')).toBeNull();
  });

  it('reloads without switching view', () => {
    const reload = renderCrashed();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledOnce();
    expect(localStorage.getItem('officexr:viewMode')).toBeNull();
  });

  it('switches to 2D only when asked', () => {
    const reload = renderCrashed();
    fireEvent.click(screen.getByRole('button', { name: 'Switch to 2D' }));
    expect(localStorage.getItem('officexr:viewMode')).toBe('2d');
    expect(reload).toHaveBeenCalledOnce();
  });
});
