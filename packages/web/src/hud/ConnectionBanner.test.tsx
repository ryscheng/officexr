// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMultiClientHarness } from '@officexr/sdk/test-harness';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConnectionBanner } from './ConnectionBanner';
import { RECOVERED_MS, STALL_MS } from './useConnectionView';

let online: { mockReturnValue: (v: boolean) => unknown };

beforeEach(() => {
  online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function setup() {
  const alice = await createMultiClientHarness().add('alice');
  const onRetry = vi.fn();
  const onLeave = vi.fn();
  alice.actions.setRealtimeStatus('live');
  vi.useFakeTimers();
  render(<ConnectionBanner store={alice.store} onRetry={onRetry} onLeave={onLeave} />);
  return { alice, onRetry, onLeave };
}

const goOffline = () => {
  online.mockReturnValue(false);
  act(() => void window.dispatchEvent(new Event('offline')));
};
const goOnline = () => {
  online.mockReturnValue(true);
  act(() => void window.dispatchEvent(new Event('online')));
};

it('shows a toast while reconnecting and nothing when replaced', async () => {
  const { alice } = await setup();
  act(() => alice.actions.setRealtimeStatus('reconnecting'));
  expect(screen.getByRole('status').textContent).toBe('Reconnecting. You can keep moving.');
  expect(screen.queryByRole('alert')).toBeNull();
  act(() => alice.actions.setRealtimeStatus('snapshot-pending'));
  expect(screen.getByRole('status').textContent).toBe('Reconnecting. You can keep moving.');
  act(() => alice.actions.setRealtimeStatus('replaced'));
  expect(screen.getByRole('status').textContent).toBe('');
});

it('shows Connecting before the first snapshot', async () => {
  const { alice } = await setup();
  act(() => alice.actions.setRealtimeStatus('connecting'));
  expect(screen.getByRole('status').textContent).toBe('Connecting…');
});

it('turns into a banner with Retry and Leave after 20 s down', async () => {
  const { alice, onRetry, onLeave } = await setup();
  act(() => alice.actions.setRealtimeStatus('reconnecting'));
  act(() => void vi.advanceTimersByTime(STALL_MS - 1));
  expect(screen.queryByRole('alert')).toBeNull();
  act(() => void vi.advanceTimersByTime(1));
  expect(screen.getByRole('alert').textContent).toContain('Cannot reconnect');
  expect(screen.getByRole('alert').textContent).toContain('Others can not see you.');
  expect(screen.getByRole('status').textContent).toBe('');

  fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
  expect(onLeave).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(onRetry).toHaveBeenCalledTimes(1);
  const trying = screen.getByRole('button', { name: 'Trying…' }) as HTMLButtonElement;
  expect(trying.disabled).toBe(true);
});

it('says Back online for 3 s after the connection returns, then nothing', async () => {
  const { alice } = await setup();
  act(() => alice.actions.setRealtimeStatus('reconnecting'));
  act(() => void vi.advanceTimersByTime(STALL_MS));
  act(() => alice.actions.setRealtimeStatus('snapshot-pending'));
  expect(screen.getByRole('alert').textContent).toContain('Cannot reconnect');
  act(() => alice.actions.setRealtimeStatus('live'));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('status').textContent).toBe('Back online');
  act(() => void vi.advanceTimersByTime(RECOVERED_MS));
  expect(screen.getByRole('status').textContent).toBe('');
});

it('does not say Back online when the connection was never down', async () => {
  const { alice } = await setup();
  act(() => alice.actions.setRealtimeStatus('snapshot-pending'));
  act(() => alice.actions.setRealtimeStatus('live'));
  expect(screen.getByRole('status').textContent).toBe('');
});

it('shows the offline banner at once and waits for the online event before retrying', async () => {
  const { onRetry } = await setup();
  goOffline();
  expect(screen.getByRole('alert').textContent).toContain('You are offline');
  expect(screen.getByRole('alert').textContent).toContain('We keep trying. Your place is saved.');

  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(screen.getByRole('button', { name: 'Trying…' })).toBeTruthy();
  expect(onRetry).not.toHaveBeenCalled();

  goOnline();
  expect(onRetry).toHaveBeenCalledTimes(1);
});

it('says Back online when the browser returns while the socket stayed live', async () => {
  await setup();
  goOffline();
  goOnline();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('status').textContent).toBe('Back online');
});

it('keeps Retry usable on a later drop after a retry that recovered by itself', async () => {
  const { alice } = await setup();
  goOffline();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  act(() => alice.actions.setRealtimeStatus('live'));
  goOnline();
  act(() => void vi.advanceTimersByTime(RECOVERED_MS));
  goOffline();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
});
