import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useJitsi } from '@/hooks/useJitsi';
import { generateJaaSJwt } from '@/lib/jaasJwt';

function createMockChannelRef() {
  return {
    current: {
      send: vi.fn().mockResolvedValue('ok'),
      track: vi.fn().mockResolvedValue('ok'),
    },
  };
}

function renderUseJitsi(overrides: Record<string, any> = {}) {
  const channelRef = createMockChannelRef();
  const channelSubscribedRef = { current: true };
  const myPresenceRef = { current: { name: 'Test User', id: 'user-1' } as any };
  const currentUser = { id: 'user-1', name: 'Test User', email: 'test@test.com' };

  const defaults = {
    officeId: 'office-1',
    currentUser,
    userEmail: 'test@test.com',
    channelRef,
    channelSubscribedRef,
    myPresenceRef,
  };

  const props = { ...defaults, ...overrides };
  const result = renderHook(() => useJitsi(props));
  return { ...result, channelRef, channelSubscribedRef, myPresenceRef, props };
}

describe('useJitsi', () => {
  let originalRAF: typeof requestAnimationFrame;

  beforeEach(() => {
    vi.clearAllMocks();

    // Set env vars for JaaS
    vi.stubEnv('VITE_JAAS_APP_ID', 'test-app-id');
    vi.stubEnv('VITE_JAAS_API_KEY_ID', 'test-api-key-id');
    vi.stubEnv('VITE_JAAS_PRIVATE_KEY', btoa('test-private-key'));

    // Override RAF to run callback once (not loop) to prevent infinite loops in tests
    originalRAF = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = vi.fn((cb) => {
      // Don't actually call the callback to prevent infinite RAF loop
      return 1 as unknown as number;
    });

    // Mock getUserMedia to resolve immediately
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue({
      getTracks: () => [{ stop: vi.fn(), enabled: true, kind: 'audio' } as any],
      getAudioTracks: () => [{ stop: vi.fn(), enabled: true } as any],
      getVideoTracks: () => [],
    } as any);

    // Mock permissions.query
    if (navigator.permissions) {
      vi.spyOn(navigator.permissions, 'query').mockResolvedValue({ state: 'prompt' } as PermissionStatus);
    }
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRAF;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('starts with jitsiRoom = null', () => {
      const { result } = renderUseJitsi();
      expect(result.current.jitsiRoom).toBeNull();
    });

    it('starts with jitsiConnected = false', () => {
      const { result } = renderUseJitsi();
      expect(result.current.jitsiConnected).toBe(false);
    });

    it('starts with micMuted = false', () => {
      const { result } = renderUseJitsi();
      expect(result.current.micMuted).toBe(false);
    });

    it('starts with micLevel = 0', () => {
      const { result } = renderUseJitsi();
      expect(result.current.micLevel).toBe(0);
    });

    it('starts with jaasJwt = null', () => {
      const { result } = renderUseJitsi();
      // JWT generation is async, starts null
      expect(result.current.jaasJwt).toBeNull();
    });
  });

  describe('JWT generation', () => {
    it('generates JWT when all env vars and currentUser are present', async () => {
      renderUseJitsi();
      // Flush promises
      await act(async () => { await new Promise(r => setTimeout(r, 0)); });
      expect(generateJaaSJwt).toHaveBeenCalled();
    });

    it('sets jaasJwt on successful generation', async () => {
      const { result } = renderUseJitsi();
      await act(async () => { await new Promise(r => setTimeout(r, 0)); });
      expect(result.current.jaasJwt).toBe('mock-jwt-token');
    });

    it('sets jaasJwtError on failure', async () => {
      vi.mocked(generateJaaSJwt).mockRejectedValueOnce(new Error('JWT failed'));
      const { result } = renderUseJitsi();
      await act(async () => { await new Promise(r => setTimeout(r, 0)); });
      expect(result.current.jaasJwtError).toBe('JWT failed');
    });

    it('does not generate when currentUser is null', async () => {
      renderUseJitsi({ currentUser: null });
      await act(async () => { await new Promise(r => setTimeout(r, 0)); });
      expect(generateJaaSJwt).not.toHaveBeenCalled();
    });

    it('clears jwt when env vars are missing', async () => {
      vi.unstubAllEnvs();
      const { result } = renderUseJitsi();
      await act(async () => { await new Promise(r => setTimeout(r, 0)); });
      expect(result.current.jaasJwt).toBeNull();
      expect(result.current.jaasJwtError).toBeNull();
    });

    it('regenerates when currentUser.id changes', async () => {
      const { rerender } = renderHook(
        ({ currentUser }) => useJitsi({
          officeId: 'office-1',
          currentUser,
          userEmail: 'test@test.com',
          channelRef: createMockChannelRef() as any,
          channelSubscribedRef: { current: true },
          myPresenceRef: { current: null },
        }),
        { initialProps: { currentUser: { id: 'user-1', name: 'User 1', email: 'u1@test.com' } as any } },
      );
      await act(async () => { await new Promise(r => setTimeout(r, 0)); });
      vi.clearAllMocks();
      rerender({ currentUser: { id: 'user-2', name: 'User 2', email: 'u2@test.com' } as any });
      await act(async () => { await new Promise(r => setTimeout(r, 0)); });
      expect(generateJaaSJwt).toHaveBeenCalled();
    });
  });

  describe('microphone monitoring', () => {
    it('calls getUserMedia on mount', async () => {
      renderUseJitsi();
      await act(async () => { await new Promise(r => setTimeout(r, 0)); });
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
    });

    it('sets micError on permission denied', async () => {
      const err = new Error('Permission denied');
      (err as any).name = 'NotAllowedError';
      vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(err);
      const { result } = renderUseJitsi();
      await act(async () => { await new Promise(r => setTimeout(r, 0)); });
      expect(result.current.micError).toBeTruthy();
      expect(result.current.micLevel).toBe(-1);
    });

    it('sets micError for NotFoundError', async () => {
      const err = new Error('No mic');
      (err as any).name = 'NotFoundError';
      vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(err);
      const { result } = renderUseJitsi();
      await act(async () => { await new Promise(r => setTimeout(r, 0)); });
      expect(result.current.micError).toContain('No microphone hardware');
    });

    it('sets micError about HTTPS when isSecureContext is false', async () => {
      Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
      const { result } = renderUseJitsi();
      await act(async () => { await new Promise(r => setTimeout(r, 0)); });
      expect(result.current.micError).toContain('HTTPS');
      // Restore
      Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    });

    it('populates startMicRef for external restart', async () => {
      const { result } = renderUseJitsi();
      await act(async () => { await new Promise(r => setTimeout(r, 0)); });
      expect(result.current.startMicRef.current).toBeInstanceOf(Function);
    });
  });

  describe('handleMuteToggle()', () => {
    it('toggles micMuted state', () => {
      const { result } = renderUseJitsi();
      expect(result.current.micMuted).toBe(false);
      act(() => result.current.handleMuteToggle());
      expect(result.current.micMuted).toBe(true);
      act(() => result.current.handleMuteToggle());
      expect(result.current.micMuted).toBe(false);
    });
  });

  describe('handleProximityChange() - joining', () => {
    it('computes deterministic room name from sorted user IDs', () => {
      const { result } = renderUseJitsi();
      act(() => result.current.handleProximityChange(new Set(['user-2', 'user-3'])));
      // Sorted: ['user-1', 'user-2', 'user-3'], seed = 'user-1' (first alphabetically)
      expect(result.current.jitsiRoom).toBe('officexr-office-1-user-1');
    });

    it('sets jitsiRoom when nearby users appear', () => {
      const { result } = renderUseJitsi();
      act(() => result.current.handleProximityChange(new Set(['user-2'])));
      expect(result.current.jitsiRoom).not.toBeNull();
    });

    it('updates myPresenceRef with new jitsiRoom', () => {
      const { result, myPresenceRef } = renderUseJitsi();
      act(() => result.current.handleProximityChange(new Set(['user-2'])));
      expect(myPresenceRef.current?.jitsiRoom).toBe(result.current.jitsiRoom);
    });

    it('tracks updated presence on channel', () => {
      const { result, channelRef } = renderUseJitsi();
      act(() => result.current.handleProximityChange(new Set(['user-2'])));
      expect(channelRef.current!.track).toHaveBeenCalled();
    });

    it('does not change room if computed name matches current', () => {
      const { result, channelRef } = renderUseJitsi();
      act(() => result.current.handleProximityChange(new Set(['user-2'])));
      const room = result.current.jitsiRoom;
      vi.clearAllMocks();
      act(() => result.current.handleProximityChange(new Set(['user-2'])));
      expect(result.current.jitsiRoom).toBe(room);
      expect(channelRef.current!.track).not.toHaveBeenCalled();
    });
  });

  describe('handleProximityChange() - leaving', () => {
    it('starts 1500ms debounce when nearby becomes empty', () => {
      vi.useFakeTimers();
      const { result } = renderUseJitsi();
      act(() => result.current.handleProximityChange(new Set(['user-2'])));
      expect(result.current.jitsiRoom).not.toBeNull();

      act(() => result.current.handleProximityChange(new Set()));
      // Still in room — debounce hasn't fired yet
      expect(result.current.jitsiRoom).not.toBeNull();
      vi.useRealTimers();
    });

    it('clears jitsiRoom after debounce fires', () => {
      vi.useFakeTimers();
      const { result } = renderUseJitsi();
      act(() => result.current.handleProximityChange(new Set(['user-2'])));
      act(() => result.current.handleProximityChange(new Set()));
      act(() => { vi.advanceTimersByTime(1500); });
      expect(result.current.jitsiRoom).toBeNull();
      vi.useRealTimers();
    });

    it('updates presence with jitsiRoom = null after leave', () => {
      vi.useFakeTimers();
      const { result, myPresenceRef } = renderUseJitsi();
      act(() => result.current.handleProximityChange(new Set(['user-2'])));
      act(() => result.current.handleProximityChange(new Set()));
      act(() => { vi.advanceTimersByTime(1500); });
      expect(myPresenceRef.current?.jitsiRoom).toBeNull();
      vi.useRealTimers();
    });

    it('cancels debounce if new proximity arrives within 1500ms', () => {
      vi.useFakeTimers();
      const { result } = renderUseJitsi();
      act(() => result.current.handleProximityChange(new Set(['user-2'])));
      act(() => result.current.handleProximityChange(new Set())); // start debounce
      act(() => { vi.advanceTimersByTime(500); }); // 500ms into debounce
      act(() => result.current.handleProximityChange(new Set(['user-3']))); // cancel
      act(() => { vi.advanceTimersByTime(1500); }); // full debounce time passes
      expect(result.current.jitsiRoom).not.toBeNull();
      vi.useRealTimers();
    });

    it('does not leave if jitsiRoom was already null', () => {
      vi.useFakeTimers();
      const { result, channelRef } = renderUseJitsi();
      expect(result.current.jitsiRoom).toBeNull();
      vi.clearAllMocks();
      act(() => result.current.handleProximityChange(new Set()));
      act(() => { vi.advanceTimersByTime(2000); });
      expect(channelRef.current!.track).not.toHaveBeenCalled();
      vi.useRealTimers();
    });
  });

  describe('prewarm room', () => {
    it('activeJitsiRoom equals jitsiRoom when set (overrides prewarm)', async () => {
      const { result } = renderUseJitsi();
      await act(async () => { await new Promise(r => setTimeout(r, 0)); });
      act(() => result.current.handleProximityChange(new Set(['user-2'])));
      expect(result.current.activeJitsiRoom).toBe(result.current.jitsiRoom);
    });

    it('computes prewarm room from officeId and userId when jwt valid', async () => {
      const { result } = renderUseJitsi();
      await act(async () => { await new Promise(r => setTimeout(r, 0)); });
      // Once JWT is set, the prewarm room should be computed
      if (result.current.jaasJwt) {
        expect(result.current.activeJitsiRoom).toBe('officexr-office-1-user-1');
      }
    });
  });

  describe('cleanupJitsi()', () => {
    it('increments generation counter', () => {
      const { result } = renderUseJitsi();
      const gen = result.current.jitsiConnectionGenRef.current;
      act(() => result.current.cleanupJitsi());
      expect(result.current.jitsiConnectionGenRef.current).toBe(gen + 1);
    });

    it('clears connect timeout', () => {
      vi.useFakeTimers();
      const { result } = renderUseJitsi();
      result.current.jitsiConnectTimeoutRef.current = setTimeout(() => {}, 30000) as any;
      act(() => result.current.cleanupJitsi());
      expect(result.current.jitsiConnectTimeoutRef.current).toBeNull();
      vi.useRealTimers();
    });

    it('clears heartbeat interval', () => {
      vi.useFakeTimers();
      const { result } = renderUseJitsi();
      result.current.jitsiHeartbeatRef.current = setInterval(() => {}, 1000) as any;
      act(() => result.current.cleanupJitsi());
      expect(result.current.jitsiHeartbeatRef.current).toBeNull();
      vi.useRealTimers();
    });

    it('removes message event listener', () => {
      const { result } = renderUseJitsi();
      const listener = vi.fn();
      result.current.jitsiMessageListenerRef.current = listener;
      const spy = vi.spyOn(window, 'removeEventListener');
      act(() => result.current.cleanupJitsi());
      expect(spy).toHaveBeenCalledWith('message', listener);
      expect(result.current.jitsiMessageListenerRef.current).toBeNull();
    });

    it('clears remote audio decay interval', () => {
      vi.useFakeTimers();
      const { result } = renderUseJitsi();
      result.current.remoteAudioDecayRef.current = setInterval(() => {}, 200) as any;
      act(() => result.current.cleanupJitsi());
      expect(result.current.remoteAudioDecayRef.current).toBeNull();
      vi.useRealTimers();
    });

    it('disposes jitsi API', () => {
      const { result } = renderUseJitsi();
      const mockApi = { dispose: vi.fn() };
      result.current.jitsiApiRef.current = mockApi;
      act(() => result.current.cleanupJitsi());
      expect(mockApi.dispose).toHaveBeenCalled();
      expect(result.current.jitsiApiRef.current).toBeNull();
    });
  });
});
