import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockChannel, createMockRef } from '../helpers';

/**
 * Tests for the channel reconnection pattern used in RoomScene.tsx.
 *
 * When the Supabase channel status becomes 'CHANNEL_ERROR' or 'TIMED_OUT',
 * we retry the subscription after a 2s delay. The retry is skipped if the
 * channel has been replaced (e.g. effect re-ran with a new officeId).
 */

function setupReconnection(channelRef: { current: any }, channel: any, handleSubscribed: ReturnType<typeof vi.fn>) {
  const handleChannelStatus = async (status: string) => {
    channelRef.current = channel; // simulate channelRef pointing to channel
    if (status === 'SUBSCRIBED') {
      await handleSubscribed();
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      setTimeout(() => {
        if (channelRef.current === channel) {
          channel.subscribe(handleChannelStatus);
        }
      }, 2000);
    }
  };
  return handleChannelStatus;
}

describe('channel reconnection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls handleSubscribed on SUBSCRIBED', async () => {
    const channel = createMockChannel();
    const channelRef = createMockRef(channel);
    const handleSubscribed = vi.fn();
    const handleStatus = setupReconnection(channelRef, channel, handleSubscribed);

    // Override subscribe to use our handler
    channel.subscribe.mockImplementation((cb: Function) => {
      cb('SUBSCRIBED');
      return channel;
    });

    await handleStatus('SUBSCRIBED');
    expect(handleSubscribed).toHaveBeenCalledTimes(1);
  });

  it('resubscribes on CHANNEL_ERROR after 2s delay', () => {
    const channel = createMockChannel();
    const channelRef = createMockRef(channel);
    const handleSubscribed = vi.fn();
    const handleStatus = setupReconnection(channelRef, channel, handleSubscribed);

    // Don't auto-subscribe in mock
    channel.subscribe.mockImplementation(() => channel);

    handleStatus('CHANNEL_ERROR');

    // Not yet retried
    expect(channel.subscribe).not.toHaveBeenCalled();

    // After 2s delay, should retry
    vi.advanceTimersByTime(2000);
    expect(channel.subscribe).toHaveBeenCalledTimes(1);
  });

  it('resubscribes on TIMED_OUT after 2s delay', () => {
    const channel = createMockChannel();
    const channelRef = createMockRef(channel);
    const handleSubscribed = vi.fn();
    const handleStatus = setupReconnection(channelRef, channel, handleSubscribed);

    channel.subscribe.mockImplementation(() => channel);

    handleStatus('TIMED_OUT');

    expect(channel.subscribe).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000);
    expect(channel.subscribe).toHaveBeenCalledTimes(1);
  });

  it('does not resubscribe if channel was replaced before retry fires', () => {
    const channel = createMockChannel();
    const channelRef = createMockRef(channel);
    const handleSubscribed = vi.fn();
    const handleStatus = setupReconnection(channelRef, channel, handleSubscribed);

    channel.subscribe.mockImplementation(() => channel);

    handleStatus('CHANNEL_ERROR');

    // Simulate channel being replaced (e.g. user navigated to a different room)
    channelRef.current = createMockChannel();

    vi.advanceTimersByTime(2000);

    // Should NOT have retried because channelRef no longer points to original channel
    expect(channel.subscribe).not.toHaveBeenCalled();
  });

  it('does not retry on CLOSED status', () => {
    const channel = createMockChannel();
    const channelRef = createMockRef(channel);
    const handleSubscribed = vi.fn();
    const handleStatus = setupReconnection(channelRef, channel, handleSubscribed);

    channel.subscribe.mockImplementation(() => channel);

    handleStatus('CLOSED');

    vi.advanceTimersByTime(5000);
    expect(channel.subscribe).not.toHaveBeenCalled();
  });
});
