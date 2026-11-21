// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlayView3dBoundary } from './PlayView3dBoundary';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

let broken = true;

function Boom() {
  if (broken) {
    throw new Error('model 404');
  }
  return <p>world</p>;
}

function renderCrashed(reload = vi.fn()) {
  broken = true;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  render(
    <PlayView3dBoundary reload={reload}>
      <Boom />
    </PlayView3dBoundary>,
  );
  return reload;
}

describe('PlayView3dBoundary', () => {
  it('shows a plain cause, keeps the raw error under Details and leaves the stored view alone', () => {
    renderCrashed();
    expect(screen.getByRole('alert').textContent).toBe('The office view stopped');
    expect(screen.getByText('Details').closest('details')!.textContent).toContain('model 404');
    expect(localStorage.getItem('officexr:viewMode')).toBeNull();
  });

  it('Try again draws the view again without a reload', () => {
    const reload = renderCrashed();
    broken = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('world')).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads the page when a script chunk failed to load', () => {
    const reload = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    function Stale(): never {
      throw new Error('Failed to fetch dynamically imported module: /x.js');
    }
    render(
      <PlayView3dBoundary reload={reload}>
        <Stale />
      </PlayView3dBoundary>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reload).toHaveBeenCalledOnce();
  });
});
