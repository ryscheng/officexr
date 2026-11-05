// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomMenu } from './RoomMenu';
import { ViewModeMenuItem } from './ViewModeMenuItem';
import type { GpuSupport } from './viewMode';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderMenu(mode: '2d' | '3d', gpu: GpuSupport, reload = vi.fn()) {
  render(
    <RoomMenu>
      <ViewModeMenuItem mode={mode} gpu={gpu} reload={reload} />
    </RoomMenu>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
  return reload;
}

describe('ViewModeMenuItem', () => {
  it('stores the other mode and reloads', () => {
    const reload = renderMenu('3d', 'hardware');
    fireEvent.click(screen.getByRole('button', { name: '2D view' }));
    expect(localStorage.getItem('officexr:viewMode')).toBe('2d');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('offers 3D from 2D', () => {
    renderMenu('2d', 'software');
    expect(screen.getByRole('button', { name: '3D view' })).toHaveProperty('disabled', false);
  });

  it('is disabled with a reason when there is no WebGL', () => {
    const reload = renderMenu('2d', 'none');
    const button = screen.getByRole('button', { name: '3D view' });
    expect(button).toHaveProperty('disabled', true);
    fireEvent.click(button);
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toMatch(/WebGL/);
  });
});
