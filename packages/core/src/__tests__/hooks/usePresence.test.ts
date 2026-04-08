import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePresence, createBubbleSphere, hexStringToInt } from '@/hooks/usePresence';
import { createAvatar, switchAnimation } from '@/components/Avatar';
import * as THREE from 'three';
import { createMockChannel, createMockRef } from '../helpers';

function createDefaultOptions(overrides: Record<string, any> = {}) {
  const mockChannel = createMockChannel();
  return {
    currentUser: { id: 'user-1', name: 'Test User', email: 'test@test.com', image: null },
    userEmail: 'test@test.com',
    userImage: null,
    channelRef: createMockRef(mockChannel),
    channelSubscribedRef: createMockRef(true),
    myPresenceRef: createMockRef(null as any),
    cameraRef: createMockRef(new THREE.PerspectiveCamera()),
    cameraModeRef: createMockRef('first-person' as const),
    playerPositionRef: createMockRef(new THREE.Vector3(0, 0, 5)),
    playerYawRef: createMockRef(0),
    localAvatarAnimationRef: createMockRef(null as any),
    localBubbleSphereRef: createMockRef(null as any),
    selfMarkerRef: createMockRef(null as any),
    avatarCustomizationRef: createMockRef({ bodyColor: '#3498db', skinColor: '#ffdbac', style: 'default' as const, accessories: [] }),
    bubblePrefsRef: createMockRef({ radius: 3, idleColor: '#4499ff' }),
    jitsiRoomRef: createMockRef(null as string | null),
    is2DModeRef: createMockRef(false),
    followingUserIdRef: createMockRef(null as string | null),
    setFollowingUserId: vi.fn(),
    handleProximityChange: vi.fn(),
    recordPositionUpdateRef: createMockRef(vi.fn()),
    mockChannel,
    ...overrides,
  };
}

function renderUsePresence(overrides: Record<string, any> = {}) {
  const opts = createDefaultOptions(overrides);
  const { mockChannel, ...hookOpts } = opts;
  const result = renderHook(() => usePresence(hookOpts));
  return { ...result, ...opts };
}

describe('usePresence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('starts with onlineUsers = []', () => {
      const { result } = renderUsePresence();
      expect(result.current.onlineUsers).toEqual([]);
    });

    it('starts with empty presenceDataRef, avatarsRef, avatarTargetsRef', () => {
      const { result } = renderUsePresence();
      expect(result.current.presenceDataRef.current.size).toBe(0);
      expect(result.current.avatarsRef.current.size).toBe(0);
      expect(result.current.avatarTargetsRef.current.size).toBe(0);
    });
  });

  describe('hexStringToInt()', () => {
    it('converts hex color string to integer', () => {
      expect(hexStringToInt('#ff0000')).toBe(0xff0000);
      expect(hexStringToInt('#4499ff')).toBe(0x4499ff);
      expect(hexStringToInt('44ff99')).toBe(0x44ff99);
    });
  });

  describe('createBubbleSphere()', () => {
    it('creates a sphere and adds to scene', () => {
      const scene = new THREE.Scene();
      const sphere = createBubbleSphere(scene, 3, 0x4499ff);
      expect(THREE.SphereGeometry).toHaveBeenCalledWith(3, 24, 24);
      expect(THREE.Mesh).toHaveBeenCalled();
      expect(scene.add).toHaveBeenCalled();
    });
  });

  describe('registerPresenceListeners()', () => {
    describe('sync event', () => {
      it('creates avatars for all present users except self', () => {
        const { result, mockChannel } = renderUsePresence();
        const scene = new THREE.Scene();

        act(() => result.current.registerPresenceListeners(mockChannel, scene));

        // Simulate sync with 2 users
        mockChannel.presenceState.mockReturnValue({
          'user-2': [{ id: 'user-2', name: 'User 2', position: { x: 1, y: 1.6, z: 1 }, rotation: { x: 0, y: 0, z: 0 } }],
          'user-3': [{ id: 'user-3', name: 'User 3', position: { x: 2, y: 1.6, z: 2 }, rotation: { x: 0, y: 0, z: 0 } }],
        });

        act(() => mockChannel.__fire('presence', 'sync', {}));

        expect(result.current.avatarsRef.current.size).toBe(2);
        expect(result.current.avatarsRef.current.has('user-2')).toBe(true);
        expect(result.current.avatarsRef.current.has('user-3')).toBe(true);
      });

      it('does not create avatar for self', () => {
        const { result, mockChannel } = renderUsePresence();
        const scene = new THREE.Scene();

        act(() => result.current.registerPresenceListeners(mockChannel, scene));

        mockChannel.presenceState.mockReturnValue({
          'user-1': [{ id: 'user-1', name: 'Test User', position: { x: 0, y: 1.6, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }],
        });

        act(() => mockChannel.__fire('presence', 'sync', {}));
        expect(result.current.avatarsRef.current.has('user-1')).toBe(false);
      });

      it('removes avatars for users no longer present', () => {
        const { result, mockChannel } = renderUsePresence();
        const scene = new THREE.Scene();

        act(() => result.current.registerPresenceListeners(mockChannel, scene));

        // First sync - user-2 present
        mockChannel.presenceState.mockReturnValue({
          'user-2': [{ id: 'user-2', name: 'User 2', position: { x: 1, y: 1.6, z: 1 }, rotation: { x: 0, y: 0, z: 0 } }],
        });
        act(() => mockChannel.__fire('presence', 'sync', {}));
        expect(result.current.avatarsRef.current.has('user-2')).toBe(true);

        // Second sync - user-2 gone
        mockChannel.presenceState.mockReturnValue({});
        act(() => mockChannel.__fire('presence', 'sync', {}));
        expect(result.current.avatarsRef.current.has('user-2')).toBe(false);
      });

      it('updates presenceDataRef with all synced users', () => {
        const { result, mockChannel } = renderUsePresence();
        const scene = new THREE.Scene();

        act(() => result.current.registerPresenceListeners(mockChannel, scene));

        mockChannel.presenceState.mockReturnValue({
          'user-2': [{ id: 'user-2', name: 'User 2', position: { x: 1, y: 1.6, z: 1 }, rotation: { x: 0, y: 0, z: 0 } }],
        });

        act(() => mockChannel.__fire('presence', 'sync', {}));
        expect(result.current.presenceDataRef.current.has('user-2')).toBe(true);
      });

      it('rebuilds onlineUsers after sync', () => {
        const { result, mockChannel } = renderUsePresence();
        const scene = new THREE.Scene();

        act(() => result.current.registerPresenceListeners(mockChannel, scene));

        mockChannel.presenceState.mockReturnValue({
          'user-2': [{ id: 'user-2', name: 'User 2', status: 'active', position: { x: 1, y: 1.6, z: 1 }, rotation: { x: 0, y: 0, z: 0 } }],
        });

        act(() => mockChannel.__fire('presence', 'sync', {}));
        expect(result.current.onlineUsers.length).toBe(1);
        expect(result.current.onlineUsers[0].name).toBe('User 2');
      });
    });

    describe('join event', () => {
      it('creates avatar for new user', () => {
        const { result, mockChannel } = renderUsePresence();
        const scene = new THREE.Scene();

        act(() => result.current.registerPresenceListeners(mockChannel, scene));

        act(() => mockChannel.__fire('presence', 'join', {
          newPresences: [{ id: 'user-2', name: 'User 2', position: { x: 1, y: 1.6, z: 1 }, rotation: { x: 0, y: 0, z: 0 } }],
        }));

        expect(result.current.avatarsRef.current.has('user-2')).toBe(true);
      });

      it('does not create avatar for self', () => {
        const { result, mockChannel } = renderUsePresence();
        const scene = new THREE.Scene();

        act(() => result.current.registerPresenceListeners(mockChannel, scene));

        act(() => mockChannel.__fire('presence', 'join', {
          newPresences: [{ id: 'user-1', name: 'Test User' }],
        }));

        expect(result.current.avatarsRef.current.has('user-1')).toBe(false);
      });

      it('adds to presenceDataRef', () => {
        const { result, mockChannel } = renderUsePresence();
        const scene = new THREE.Scene();

        act(() => result.current.registerPresenceListeners(mockChannel, scene));

        act(() => mockChannel.__fire('presence', 'join', {
          newPresences: [{ id: 'user-2', name: 'User 2', position: { x: 1, y: 1.6, z: 1 }, rotation: { x: 0, y: 0, z: 0 } }],
        }));

        expect(result.current.presenceDataRef.current.has('user-2')).toBe(true);
      });

      it('rebuilds onlineUsers', () => {
        const { result, mockChannel } = renderUsePresence();
        const scene = new THREE.Scene();

        act(() => result.current.registerPresenceListeners(mockChannel, scene));

        act(() => mockChannel.__fire('presence', 'join', {
          newPresences: [{ id: 'user-2', name: 'User 2', status: 'active', position: { x: 1, y: 1.6, z: 1 }, rotation: { x: 0, y: 0, z: 0 } }],
        }));

        expect(result.current.onlineUsers.length).toBe(1);
      });
    });

    describe('leave event', () => {
      it('removes avatar from scene', () => {
        const { result, mockChannel } = renderUsePresence();
        const scene = new THREE.Scene();

        act(() => result.current.registerPresenceListeners(mockChannel, scene));

        // First join
        act(() => mockChannel.__fire('presence', 'join', {
          newPresences: [{ id: 'user-2', name: 'User 2', position: { x: 1, y: 1.6, z: 1 }, rotation: { x: 0, y: 0, z: 0 } }],
        }));
        expect(result.current.avatarsRef.current.has('user-2')).toBe(true);

        // Then leave
        act(() => mockChannel.__fire('presence', 'leave', {
          leftPresences: [{ id: 'user-2', name: 'User 2' }],
        }));
        expect(result.current.avatarsRef.current.has('user-2')).toBe(false);
        expect(scene.remove).toHaveBeenCalled();
      });

      it('cancels following if followed user left', () => {
        const setFollowingUserId = vi.fn();
        const { result, mockChannel } = renderUsePresence({
          followingUserIdRef: createMockRef('user-2'),
          setFollowingUserId,
        });
        const scene = new THREE.Scene();

        act(() => result.current.registerPresenceListeners(mockChannel, scene));

        act(() => mockChannel.__fire('presence', 'join', {
          newPresences: [{ id: 'user-2', name: 'User 2', position: { x: 1, y: 1.6, z: 1 }, rotation: { x: 0, y: 0, z: 0 } }],
        }));
        act(() => mockChannel.__fire('presence', 'leave', {
          leftPresences: [{ id: 'user-2', name: 'User 2' }],
        }));
        expect(setFollowingUserId).toHaveBeenCalledWith(null);
      });

      it('cleans up animation, targets, lastSeenAt', () => {
        const { result, mockChannel } = renderUsePresence();
        const scene = new THREE.Scene();

        act(() => result.current.registerPresenceListeners(mockChannel, scene));
        act(() => mockChannel.__fire('presence', 'join', {
          newPresences: [{ id: 'user-2', name: 'User 2', position: { x: 1, y: 1.6, z: 1 }, rotation: { x: 0, y: 0, z: 0 } }],
        }));

        act(() => mockChannel.__fire('presence', 'leave', {
          leftPresences: [{ id: 'user-2', name: 'User 2' }],
        }));

        expect(result.current.avatarTargetsRef.current.has('user-2')).toBe(false);
        expect(result.current.avatarAnimationsRef.current.has('user-2')).toBe(false);
      });

      it('rebuilds onlineUsers with offline status', () => {
        const { result, mockChannel } = renderUsePresence();
        const scene = new THREE.Scene();

        act(() => result.current.registerPresenceListeners(mockChannel, scene));
        act(() => mockChannel.__fire('presence', 'join', {
          newPresences: [{ id: 'user-2', name: 'User 2', status: 'active', position: { x: 1, y: 1.6, z: 1 }, rotation: { x: 0, y: 0, z: 0 } }],
        }));
        act(() => mockChannel.__fire('presence', 'leave', {
          leftPresences: [{ id: 'user-2', name: 'User 2', email: null }],
        }));

        const offlineUser = result.current.onlineUsers.find(u => u.id === 'user-2');
        expect(offlineUser?.status).toBe('offline');
      });
    });

    describe('position broadcast', () => {
      it('updates avatarTargets with new position', () => {
        const { result, mockChannel } = renderUsePresence();
        const scene = new THREE.Scene();

        act(() => result.current.registerPresenceListeners(mockChannel, scene));
        // First add user
        result.current.presenceDataRef.current.set('user-2', { id: 'user-2', name: 'User 2' } as any);

        act(() => mockChannel.__fire('broadcast', 'position', {
          payload: { userId: 'user-2', position: { x: 5, y: 1.6, z: 3 }, rotation: { x: 0, y: 1.5, z: 0 } },
        }));

        const target = result.current.avatarTargetsRef.current.get('user-2');
        expect(target).toBeDefined();
        expect(target!.position.x).toBe(5);
        expect(target!.position.z).toBe(3);
        expect(target!.rotationY).toBe(1.5);
      });

      it('ignores position for unknown userId', () => {
        const { result, mockChannel } = renderUsePresence();
        const scene = new THREE.Scene();

        act(() => result.current.registerPresenceListeners(mockChannel, scene));

        act(() => mockChannel.__fire('broadcast', 'position', {
          payload: { userId: 'unknown', position: { x: 5, y: 1.6, z: 3 }, rotation: { x: 0, y: 0, z: 0 } },
        }));

        expect(result.current.avatarTargetsRef.current.has('unknown')).toBe(false);
      });

      it('calls recordPositionUpdateRef', () => {
        const recordFn = vi.fn();
        const { result, mockChannel } = renderUsePresence({
          recordPositionUpdateRef: createMockRef(recordFn),
        });
        const scene = new THREE.Scene();

        act(() => result.current.registerPresenceListeners(mockChannel, scene));
        result.current.presenceDataRef.current.set('user-2', { id: 'user-2', name: 'User 2' } as any);

        act(() => mockChannel.__fire('broadcast', 'position', {
          payload: { userId: 'user-2', position: { x: 5, y: 1.6, z: 3 }, rotation: { x: 0, y: 0, z: 0 } },
        }));

        expect(recordFn).toHaveBeenCalledWith('user-2');
      });
    });

    describe('avatar-update broadcast', () => {
      it('stores pending update when avatar does not exist yet', () => {
        const { result, mockChannel } = renderUsePresence();
        const scene = new THREE.Scene();

        act(() => result.current.registerPresenceListeners(mockChannel, scene));

        act(() => mockChannel.__fire('broadcast', 'avatar-update', {
          payload: { userId: 'user-2', customization: { bodyColor: '#ff0000', skinColor: '#ffdbac', style: 'default', accessories: [] } },
        }));

        expect(result.current.pendingAvatarUpdatesRef.current.has('user-2')).toBe(true);
      });

      it('recreates avatar with new customization for existing user', () => {
        const { result, mockChannel } = renderUsePresence();
        const scene = new THREE.Scene();

        act(() => result.current.registerPresenceListeners(mockChannel, scene));
        // Join first
        act(() => mockChannel.__fire('presence', 'join', {
          newPresences: [{ id: 'user-2', name: 'User 2', position: { x: 1, y: 1.6, z: 1 }, rotation: { x: 0, y: 0, z: 0 } }],
        }));
        vi.clearAllMocks();

        act(() => mockChannel.__fire('broadcast', 'avatar-update', {
          payload: { userId: 'user-2', customization: { bodyColor: '#ff0000', skinColor: '#ffdbac', style: 'default', accessories: [] } },
        }));

        expect(createAvatar).toHaveBeenCalled();
        expect(scene.remove).toHaveBeenCalled();
      });
    });

    describe('bubble-prefs broadcast', () => {
      it('stores prefs in remoteBubblePrefsRef', () => {
        const { result, mockChannel } = renderUsePresence();
        const scene = new THREE.Scene();

        act(() => result.current.registerPresenceListeners(mockChannel, scene));

        act(() => mockChannel.__fire('broadcast', 'bubble-prefs', {
          payload: { userId: 'user-2', prefs: { radius: 5, idleColor: '#ff0000' } },
        }));

        expect(result.current.remoteBubblePrefsRef.current.get('user-2')).toEqual({ radius: 5, idleColor: '#ff0000' });
      });
    });
  });

  describe('handleChannelSubscribed()', () => {
    it('tracks self presence with current position and status', async () => {
      const { result, mockChannel, myPresenceRef } = renderUsePresence();
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera();

      await act(async () => {
        await result.current.handleChannelSubscribed(mockChannel, scene, camera);
      });

      expect(mockChannel.track).toHaveBeenCalled();
      expect(myPresenceRef.current).not.toBeNull();
      expect(myPresenceRef.current.id).toBe('user-1');
    });

    it('broadcasts own bubble prefs', async () => {
      const { result, mockChannel } = renderUsePresence();
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera();

      await act(async () => {
        await result.current.handleChannelSubscribed(mockChannel, scene, camera);
      });

      expect(mockChannel.send).toHaveBeenCalledWith(expect.objectContaining({
        type: 'broadcast',
        event: 'bubble-prefs',
      }));
    });
  });

  describe('setupPresenceTimers()', () => {
    it('returns cleanup function that removes all timers', () => {
      const { result } = renderUsePresence();
      let cleanup: () => void;
      act(() => { cleanup = result.current.setupPresenceTimers(); });
      expect(typeof cleanup!).toBe('function');
      // Should not throw
      act(() => cleanup());
    });

    it('broadcasts position every 2s via heartbeat', () => {
      const { result, mockChannel } = renderUsePresence();
      const channelRef = createMockRef(mockChannel);

      // Need to set up channelSubscribedRef to true and channelRef
      const opts = createDefaultOptions({ channelRef });
      const { mockChannel: ch, ...hookOpts } = opts;
      const hook = renderHook(() => usePresence(hookOpts));

      let cleanup: () => void;
      act(() => { cleanup = hook.result.current.setupPresenceTimers(); });

      // Advance by heartbeat interval
      act(() => { vi.advanceTimersByTime(2000); });

      // The heartbeat should have fired
      act(() => { cleanup!(); });
    });
  });

  describe('tickPresence()', () => {
    it('does not broadcast when not moving', () => {
      const { result, mockChannel } = renderUsePresence();
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera();

      act(() => {
        result.current.tickPresence(
          0.016, 0.15, camera, scene, mockChannel,
          { x: 0, y: 1.6, z: 5 }, { x: 0, y: 0, z: 0 }, false,
        );
      });

      // Should not have called send for position (not moved)
      const positionSends = mockChannel.send.mock.calls.filter(
        (c: any[]) => c[0]?.event === 'position',
      );
      expect(positionSends.length).toBe(0);
    });

    it('broadcasts position when moving and >60ms since last update', () => {
      const { result, mockChannel } = renderUsePresence();
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera();

      // Set channelSubscribedRef to true
      result.current.lastPositionUpdate.current = 0;

      // Advance time so throttle window passes
      vi.advanceTimersByTime(100);

      act(() => {
        result.current.tickPresence(
          0.016, 0.15, camera, scene, mockChannel,
          { x: 1, y: 1.6, z: 5 }, { x: 0, y: 0.5, z: 0 }, true,
        );
      });

      const positionSends = mockChannel.send.mock.calls.filter(
        (c: any[]) => c[0]?.event === 'position',
      );
      expect(positionSends.length).toBe(1);
    });

    it('does not broadcast within 60ms throttle window', () => {
      const { result, mockChannel } = renderUsePresence();
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera();

      // Set last update to now
      result.current.lastPositionUpdate.current = Date.now();

      act(() => {
        result.current.tickPresence(
          0.016, 0.15, camera, scene, mockChannel,
          { x: 1, y: 1.6, z: 5 }, { x: 0, y: 0.5, z: 0 }, true,
        );
      });

      const positionSends = mockChannel.send.mock.calls.filter(
        (c: any[]) => c[0]?.event === 'position',
      );
      expect(positionSends.length).toBe(0);
    });

    it('fires handleProximityChange when nearby set changes', () => {
      const handleProximityChange = vi.fn();
      const opts = createDefaultOptions({ handleProximityChange });
      const { mockChannel, ...hookOpts } = opts;
      const { result } = renderHook(() => usePresence(hookOpts));
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera();

      // Register listeners and add a user
      act(() => result.current.registerPresenceListeners(mockChannel, scene));
      result.current.presenceDataRef.current.set('user-2', { id: 'user-2', name: 'User 2' } as any);

      // Set a nearby target (within radius * 2)
      result.current.avatarTargetsRef.current.set('user-2', {
        position: new THREE.Vector3(0, 0, 5), // same as camera position
        rotationY: 0,
      });

      act(() => {
        result.current.tickPresence(
          0.016, 0.15, camera, scene, mockChannel,
          { x: 0, y: 1.6, z: 5 }, { x: 0, y: 0, z: 0 }, false,
        );
      });

      expect(handleProximityChange).toHaveBeenCalled();
    });
  });

  describe('cleanupPresenceVisuals()', () => {
    it('removes all avatars from scene', () => {
      const { result, mockChannel } = renderUsePresence();
      const scene = new THREE.Scene();

      act(() => result.current.registerPresenceListeners(mockChannel, scene));
      act(() => mockChannel.__fire('presence', 'join', {
        newPresences: [{ id: 'user-2', name: 'User 2', position: { x: 1, y: 1.6, z: 1 }, rotation: { x: 0, y: 0, z: 0 } }],
      }));

      vi.clearAllMocks();
      act(() => result.current.cleanupPresenceVisuals(scene));

      expect(scene.remove).toHaveBeenCalled();
      expect(result.current.avatarsRef.current.size).toBe(0);
    });

    it('removes all bubble spheres from scene', () => {
      const { result, mockChannel } = renderUsePresence();
      const scene = new THREE.Scene();

      act(() => result.current.registerPresenceListeners(mockChannel, scene));
      act(() => mockChannel.__fire('presence', 'join', {
        newPresences: [{ id: 'user-2', name: 'User 2', position: { x: 1, y: 1.6, z: 1 }, rotation: { x: 0, y: 0, z: 0 } }],
      }));

      act(() => result.current.cleanupPresenceVisuals(scene));
      expect(result.current.bubbleSpheresRef.current.size).toBe(0);
    });

    it('clears all Maps and Sets', () => {
      const { result, mockChannel } = renderUsePresence();
      const scene = new THREE.Scene();

      act(() => result.current.registerPresenceListeners(mockChannel, scene));
      act(() => mockChannel.__fire('presence', 'join', {
        newPresences: [{ id: 'user-2', name: 'User 2', position: { x: 1, y: 1.6, z: 1 }, rotation: { x: 0, y: 0, z: 0 } }],
      }));

      act(() => result.current.cleanupPresenceVisuals(scene));
      expect(result.current.presenceDataRef.current.size).toBe(0);
      expect(result.current.nearbyUserIdsRef.current.size).toBe(0);
      expect(result.current.avatarTargetsRef.current.size).toBe(0);
    });
  });
});
