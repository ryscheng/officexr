// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Bell } from 'lucide-react';
import { afterEach, expect, it, vi } from 'vitest';
import { IconButton } from '../IconButton';
import { SegmentedControl } from './SegmentedControl';
import { Switch } from './Switch';

afterEach(cleanup);

it('SegmentedControl reports the chosen option and ignores re-clicking the selected one', () => {
  const onValueChange = vi.fn();
  render(
    <SegmentedControl
      aria-label="Mode"
      value="a"
      options={[
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ]}
      onValueChange={onValueChange}
    />,
  );
  fireEvent.click(screen.getByText('A'));
  expect(onValueChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('B'));
  expect(onValueChange).toHaveBeenCalledWith('b');
});

it('Switch reflects checked', () => {
  const { rerender } = render(<Switch aria-label="Sound" checked={false} onCheckedChange={() => {}} />);
  expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
  rerender(<Switch aria-label="Sound" checked onCheckedChange={() => {}} />);
  expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
});

it('IconButton lg and accent render their classes', () => {
  render(<IconButton icon={Bell} label="Ring" onClick={() => {}} tone="accent" size="lg" />);
  const button = screen.getByRole('button', { name: 'Ring' });
  expect(button.className).toContain('bg-hud-accent');
  expect(button.className).toContain('h-11');
});
