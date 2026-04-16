import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRealtimeChannel } from '@/hooks/useRealtimeChannel';
import { supabase } from '@/lib/supabase';

describe('useRealtimeChannel', () => {
  let mockChannel: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockChannel = {
      track: vi.fn().mockResolvedValue('ok'),
      untrack: vi.fn().mockResolvedValue('ok'),
      send: vi.fn().mockResolvedValue('ok'),
    };
    vi.mocked(supabase.channel).mockReturnValue(mockChannel as any);
  });

  describe('channel lifecycle', () => {
    it('does not create channel when userId is undefined', () => {
      renderHook(() => useRealtimeChannel({ officeId: 'office-1', userId: undefined }));
      expect(supabase.channel).not.toHaveBeenCalled();
    });

    it('creates channel with correct name "office:{officeId}" on mount', () => {
      renderHook(() => useRealtimeChannel({ officeId: 'office-1', userId: 'user-1' }));
      expect(supabase.channel).toHaveBeenCalledWith('office:office-1', expect.any(Object));
    });

    it('configures channel with presence key = userId and broadcast ack=true self=false', () => {
      renderHook(() => useRealtimeChannel({ officeId: 'office-1', userId: 'user-1' }));
      expect(supabase.channel).toHaveBeenCalledWith('office:office-1', {
        config: {
          presence: { key: 'user-1' },
          broadcast: { ack: true, self: false },
        },
      });
    });

    it('populates channelRef.current after mount', () => {
      const { result } = renderHook(() =>
        useRealtimeChannel({ officeId: 'office-1', userId: 'user-1' }),
      );
      expect(result.current.channelRef.current).toBe(mockChannel);
    });

    it('starts with channelSubscribedRef = false', () => {
      const { result } = renderHook(() =>
        useRealtimeChannel({ officeId: 'office-1', userId: 'user-1' }),
      );
      expect(result.current.channelSubscribedRef.current).toBe(false);
    });

    it('starts with myPresenceRef = null', () => {
      const { result } = renderHook(() =>
        useRealtimeChannel({ officeId: 'office-1', userId: 'user-1' }),
      );
      expect(result.current.myPresenceRef.current).toBeNull();
    });

    it('calls untrack + removeChannel on unmount', () => {
      const { unmount } = renderHook(() =>
        useRealtimeChannel({ officeId: 'office-1', userId: 'user-1' }),
      );
      unmount();
      expect(mockChannel.untrack).toHaveBeenCalled();
      expect(supabase.removeChannel).toHaveBeenCalledWith(mockChannel);
    });

    it('nulls all refs on unmount', () => {
      const { result, unmount } = renderHook(() =>
        useRealtimeChannel({ officeId: 'office-1', userId: 'user-1' }),
      );
      unmount();
      expect(result.current.channelRef.current).toBeNull();
      expect(result.current.channelSubscribedRef.current).toBe(false);
      expect(result.current.myPresenceRef.current).toBeNull();
    });

    it('recreates channel when userId changes', () => {
      const { rerender } = renderHook(
        ({ userId }) => useRealtimeChannel({ officeId: 'office-1', userId }),
        { initialProps: { userId: 'user-1' as string | undefined } },
      );
      vi.clearAllMocks();
      rerender({ userId: 'user-2' });
      expect(supabase.channel).toHaveBeenCalledWith('office:office-1', expect.objectContaining({
        config: expect.objectContaining({ presence: { key: 'user-2' } }),
      }));
    });

    it('recreates channel when officeId changes', () => {
      const { rerender } = renderHook(
        ({ officeId }) => useRealtimeChannel({ officeId, userId: 'user-1' }),
        { initialProps: { officeId: 'office-1' } },
      );
      vi.clearAllMocks();
      rerender({ officeId: 'office-2' });
      expect(supabase.channel).toHaveBeenCalledWith('office:office-2', expect.any(Object));
    });

    it('cleans up old channel before creating new one on dep change', () => {
      const oldChannel = { track: vi.fn(), untrack: vi.fn(), send: vi.fn() };
      const newChannel = { track: vi.fn(), untrack: vi.fn(), send: vi.fn() };
      vi.mocked(supabase.channel)
        .mockReturnValueOnce(oldChannel as any)
        .mockReturnValueOnce(newChannel as any);

      const { rerender, result } = renderHook(
        ({ userId }) => useRealtimeChannel({ officeId: 'office-1', userId }),
        { initialProps: { userId: 'user-1' as string | undefined } },
      );
      expect(result.current.channelRef.current).toBe(oldChannel);

      rerender({ userId: 'user-2' });
      expect(oldChannel.untrack).toHaveBeenCalled();
      expect(supabase.removeChannel).toHaveBeenCalledWith(oldChannel);
      expect(result.current.channelRef.current).toBe(newChannel);
    });
  });

  describe('send()', () => {
    it('no-ops when channelRef is null', () => {
      const { result } = renderHook(() =>
        useRealtimeChannel({ officeId: 'office-1', userId: undefined }),
      );
      act(() => result.current.send('test', { data: 1 }));
      expect(mockChannel.send).not.toHaveBeenCalled();
    });

    it('no-ops when channelSubscribedRef is false', () => {
      const { result } = renderHook(() =>
        useRealtimeChannel({ officeId: 'office-1', userId: 'user-1' }),
      );
      // channelSubscribedRef defaults to false
      act(() => result.current.send('test', { data: 1 }));
      expect(mockChannel.send).not.toHaveBeenCalled();
    });

    it('sends broadcast with correct type/event/payload when subscribed', () => {
      const { result } = renderHook(() =>
        useRealtimeChannel({ officeId: 'office-1', userId: 'user-1' }),
      );
      // Simulate subscription
      act(() => { result.current.channelSubscribedRef.current = true; });
      act(() => result.current.send('chat', { message: 'hi' }));
      expect(mockChannel.send).toHaveBeenCalledWith({
        type: 'broadcast',
        event: 'chat',
        payload: { message: 'hi' },
      });
    });
  });

  describe('track()', () => {
    it('no-ops when channelRef is null', () => {
      const { result } = renderHook(() =>
        useRealtimeChannel({ officeId: 'office-1', userId: undefined }),
      );
      const data = { name: 'Test', id: 'user-1' } as any;
      act(() => result.current.track(data));
      // Should not throw and channel.track should not be called
      expect(mockChannel.track).not.toHaveBeenCalled();
    });

    it('updates myPresenceRef with provided data', () => {
      const { result } = renderHook(() =>
        useRealtimeChannel({ officeId: 'office-1', userId: 'user-1' }),
      );
      const data = { name: 'Test', id: 'user-1' } as any;
      act(() => result.current.track(data));
      expect(result.current.myPresenceRef.current).toBe(data);
    });

    it('calls channel.track() with data', () => {
      const { result } = renderHook(() =>
        useRealtimeChannel({ officeId: 'office-1', userId: 'user-1' }),
      );
      const data = { name: 'Test', id: 'user-1' } as any;
      act(() => result.current.track(data));
      expect(mockChannel.track).toHaveBeenCalledWith(data);
    });
  });
});
