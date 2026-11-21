// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { JaasVoiceAdapter } from '../voice/JaasVoiceAdapter';
import { TextOnlyCall } from './TextOnlyCall';

afterEach(cleanup);

it('says text only and that chat works', () => {
  render(<TextOnlyCall voice={null} />);
  expect(screen.getByRole('status').textContent).toContain('Text only');
  expect(screen.getByRole('status').textContent).toContain('Mic off · chat works');
});

it('has no Leave without a call to leave and clears the failed call with it', () => {
  const { rerender } = render(<TextOnlyCall voice={null} />);
  expect(screen.queryByRole('button', { name: 'Leave call' })).toBeNull();
  const leaveRoom = vi.fn(() => Promise.resolve());
  rerender(<TextOnlyCall voice={{ leaveRoom } as unknown as JaasVoiceAdapter} />);
  fireEvent.click(screen.getByRole('button', { name: 'Leave call' }));
  expect(leaveRoom).toHaveBeenCalledTimes(1);
});
