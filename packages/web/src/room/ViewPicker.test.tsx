// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ViewPicker } from './ViewPicker';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('ViewPicker', () => {
  it('lists every view with a hint and marks the current one', () => {
    render(<ViewPicker value="angled" onOpenView={() => {}} />);
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    expect(screen.getByRole('radio', { name: /^Angled/ }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: /^Free look/ }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('Camera behind you. Drag to turn it.')).toBeTruthy();
  });

  it('switches between 3D views without a reload and remembers the choice', () => {
    const reload = vi.fn();
    const onOpenView = vi.fn();
    render(<ViewPicker value="angled" onOpenView={onOpenView} reload={reload} />);
    fireEvent.click(screen.getByRole('radio', { name: /^First person/ }));
    expect(onOpenView).toHaveBeenCalledWith('first-person');
    expect(localStorage.getItem('officexr:gameView')).toBe('first-person');
    expect(reload).not.toHaveBeenCalled();
  });

  it('stores the 2D mode and reloads for Map (2D)', () => {
    const reload = vi.fn();
    render(<ViewPicker value="angled" onOpenView={() => {}} reload={reload} />);
    fireEvent.click(screen.getByRole('radio', { name: /^Map \(2D\)/ }));
    expect(localStorage.getItem('officexr:viewMode')).toBe('2d');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('leaves the map for a 3D view by storing both and reloading', () => {
    const reload = vi.fn();
    const onOpenView = vi.fn();
    render(<ViewPicker value="map" onOpenView={onOpenView} reload={reload} />);
    fireEvent.click(screen.getByRole('radio', { name: /^Bird's-eye/ }));
    expect(localStorage.getItem('officexr:viewMode')).toBe('3d');
    expect(localStorage.getItem('officexr:gameView')).toBe('birds-eye');
    expect(reload).toHaveBeenCalledOnce();
    expect(onOpenView).not.toHaveBeenCalled();
  });

  it('does nothing when the current view is chosen again', () => {
    const reload = vi.fn();
    const onOpenView = vi.fn();
    render(<ViewPicker value="map" onOpenView={onOpenView} reload={reload} />);
    fireEvent.click(screen.getByRole('radio', { name: /^Map \(2D\)/ }));
    expect(reload).not.toHaveBeenCalled();
    expect(onOpenView).not.toHaveBeenCalled();
  });
});
