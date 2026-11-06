// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { createMultiClientHarness } from '@officexr/sdk/test-harness';
import { afterEach, expect, it } from 'vitest';
import { ConnectionToast } from './ConnectionToast';

afterEach(cleanup);

it('shows while reconnecting or connecting and hides when live or replaced', async () => {
  const alice = await createMultiClientHarness().add('alice');
  render(<ConnectionToast store={alice.store} />);
  act(() => alice.actions.setRealtimeStatus('reconnecting'));
  expect(screen.getByRole('status').textContent).toContain('Reconnecting…');
  expect(screen.getByText('You can keep moving; others will catch up')).toBeTruthy();
  act(() => alice.actions.setRealtimeStatus('snapshot-pending'));
  expect(screen.getByRole('status').textContent).toBe('Connecting…');
  for (const status of ['live', 'replaced'] as const) {
    act(() => alice.actions.setRealtimeStatus(status));
    expect(screen.getByRole('status').textContent).toBe('');
  }
});
