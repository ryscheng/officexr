// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { HINT_FLAG_PREFIX } from '../hintFlags';
import { HelpPage } from './HelpPage';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('HelpPage', () => {
  it('shows how to move on touch, with no keycaps', () => {
    render(<HelpPage coarse />);
    expect(screen.getByRole('heading', { name: 'How to move' })).toBeTruthy();
    expect(screen.queryByText('W A S D / Arrow keys')).toBeNull();
    expect(screen.queryByText('Hold right mouse button or drag to look around.')).toBeNull();
  });

  it('shows the keyboard shortcuts on desktop', () => {
    render(<HelpPage coarse={false} />);
    expect(screen.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeTruthy();
    expect(screen.getByText('W A S D / Arrow keys')).toBeTruthy();
    expect(screen.getByText('Open help and shortcuts')).toBeTruthy();
    expect(screen.getByText('Hold right mouse button or drag to look around.')).toBeTruthy();
  });

  it('clears only the hint flags with Show hints again', () => {
    localStorage.setItem(`${HINT_FLAG_PREFIX}joystick`, 'seen');
    localStorage.setItem(`${HINT_FLAG_PREFIX}map`, 'seen');
    localStorage.setItem('officexr:fold:missions', 'open');
    render(<HelpPage coarse />);
    fireEvent.click(screen.getByRole('button', { name: 'Show hints again' }));
    expect(localStorage.getItem(`${HINT_FLAG_PREFIX}joystick`)).toBeNull();
    expect(localStorage.getItem(`${HINT_FLAG_PREFIX}map`)).toBeNull();
    expect(localStorage.getItem('officexr:fold:missions')).toBe('open');
    expect(screen.getByRole('status').textContent).toBe('Hints will show again.');
  });
});
