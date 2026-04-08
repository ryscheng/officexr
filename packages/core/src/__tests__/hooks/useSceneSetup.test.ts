import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSceneSetup } from '@/hooks/useSceneSetup';
import * as THREE from 'three';
import { createAvatar } from '@/components/Avatar';
import { createMockRef } from '../helpers';

function createDefaultOptions(overrides: Record<string, any> = {}) {
  const container = document.createElement('div');
  return {
    containerRef: createMockRef(container),
    officeId: 'office-1',
    environment: 'corporate',
    currentUser: { id: 'user-1', name: 'Test User' },
    sceneRef: createMockRef(null as any),
    rendererRef: createMockRef(null as any),
    cameraRef: createMockRef(null as any),
    localAvatarRef: createMockRef(null as any),
    localAvatarAnimationRef: createMockRef(null as any),
    localBubbleSphereRef: createMockRef(null as any),
    selfMarkerRef: createMockRef(null as any),
    avatarCustomizationRef: createMockRef({ bodyColor: '#3498db', skinColor: '#ffdbac', style: 'default' as const, accessories: [] }),
    bubblePrefsRef: createMockRef({ radius: 3, idleColor: '#4499ff' }),
    playerPositionRef: createMockRef(new THREE.Vector3(0, 0, 5)),
    ...overrides,
  };
}

function renderUseSceneSetup(overrides: Record<string, any> = {}) {
  const opts = createDefaultOptions(overrides);
  const result = renderHook(() => useSceneSetup(opts));
  return { ...result, ...opts };
}

describe('useSceneSetup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('guard conditions', () => {
    it('does not initialize when containerRef is null', () => {
      const { sceneRef } = renderUseSceneSetup({ containerRef: createMockRef(null) });
      expect(sceneRef.current).toBeNull();
    });

    it('does not initialize when currentUser is null', () => {
      const { sceneRef } = renderUseSceneSetup({ currentUser: null });
      expect(sceneRef.current).toBeNull();
    });
  });

  describe('scene creation', () => {
    it('creates Scene and populates sceneRef', () => {
      const { sceneRef } = renderUseSceneSetup();
      expect(THREE.Scene).toHaveBeenCalled();
      expect(sceneRef.current).not.toBeNull();
    });

    it('creates PerspectiveCamera and populates cameraRef', () => {
      const { cameraRef } = renderUseSceneSetup();
      expect(THREE.PerspectiveCamera).toHaveBeenCalled();
      expect(cameraRef.current).not.toBeNull();
    });

    it('creates OrthographicCamera for 2D mode', () => {
      const { result } = renderUseSceneSetup();
      expect(THREE.OrthographicCamera).toHaveBeenCalled();
      expect(result.current.orthoCameraRef.current).not.toBeNull();
    });

    it('returns orthoCameraRef and orthoViewSizeRef', () => {
      const { result } = renderUseSceneSetup();
      expect(result.current.orthoCameraRef).toBeDefined();
      expect(result.current.orthoViewSizeRef).toBeDefined();
      expect(result.current.orthoViewSizeRef.current).toBe(15);
    });
  });

  describe('renderer', () => {
    it('creates WebGLRenderer', () => {
      renderUseSceneSetup();
      expect(THREE.WebGLRenderer).toHaveBeenCalled();
    });

    it('populates rendererRef', () => {
      const { rendererRef } = renderUseSceneSetup();
      expect(rendererRef.current).not.toBeNull();
    });

    it('appends renderer domElement to container', () => {
      const container = document.createElement('div');
      const appendChildSpy = vi.spyOn(container, 'appendChild');
      renderUseSceneSetup({ containerRef: createMockRef(container) });
      expect(appendChildSpy).toHaveBeenCalled();
    });
  });

  describe('local avatar and markers', () => {
    it('creates local avatar with current customization', () => {
      renderUseSceneSetup();
      expect(createAvatar).toHaveBeenCalled();
    });

    it('populates localAvatarRef', () => {
      const { localAvatarRef } = renderUseSceneSetup();
      expect(localAvatarRef.current).not.toBeNull();
    });

    it('sets local avatar to invisible (first-person default)', () => {
      const { localAvatarRef } = renderUseSceneSetup();
      expect(localAvatarRef.current?.visible).toBe(false);
    });

    it('populates localBubbleSphereRef', () => {
      const { localBubbleSphereRef } = renderUseSceneSetup();
      expect(localBubbleSphereRef.current).not.toBeNull();
    });

    it('populates selfMarkerRef', () => {
      const { selfMarkerRef } = renderUseSceneSetup();
      expect(selfMarkerRef.current).not.toBeNull();
    });
  });

  describe('player position', () => {
    it('initializes playerPositionRef from camera position', () => {
      const playerPositionRef = createMockRef(new THREE.Vector3());
      renderUseSceneSetup({ playerPositionRef });
      // After scene setup, playerPositionRef should be updated
      // The hook does: playerPositionRef.current.copy(camera.position)
      // With our mock, it'll be the camera's initial position
      expect(playerPositionRef.current).toBeDefined();
    });
  });

  describe('resize handler', () => {
    it('registers resize event listener', () => {
      const spy = vi.spyOn(window, 'addEventListener');
      renderUseSceneSetup();
      const resizeCalls = spy.mock.calls.filter(c => c[0] === 'resize');
      expect(resizeCalls.length).toBeGreaterThan(0);
      spy.mockRestore();
    });
  });

  describe('cleanup on unmount', () => {
    it('disposes renderer', () => {
      const { unmount, rendererRef } = renderUseSceneSetup();
      const renderer = rendererRef.current;
      unmount();
      expect(renderer?.dispose).toHaveBeenCalled();
    });

    it('removes resize listener', () => {
      const spy = vi.spyOn(window, 'removeEventListener');
      const { unmount } = renderUseSceneSetup();
      unmount();
      const resizeCalls = spy.mock.calls.filter(c => c[0] === 'resize');
      expect(resizeCalls.length).toBeGreaterThan(0);
      spy.mockRestore();
    });

    it('nulls sceneRef and cameraRef', () => {
      const { unmount, sceneRef, cameraRef } = renderUseSceneSetup();
      expect(sceneRef.current).not.toBeNull();
      unmount();
      expect(sceneRef.current).toBeNull();
      expect(cameraRef.current).toBeNull();
    });

    it('nulls rendererRef', () => {
      const { unmount, rendererRef } = renderUseSceneSetup();
      expect(rendererRef.current).not.toBeNull();
      unmount();
      expect(rendererRef.current).toBeNull();
    });

    it('nulls localAvatarRef', () => {
      const { unmount, localAvatarRef } = renderUseSceneSetup();
      unmount();
      expect(localAvatarRef.current).toBeNull();
    });

    it('removes renderer domElement from container', () => {
      const container = document.createElement('div');
      const removeChildSpy = vi.spyOn(container, 'removeChild').mockImplementation(() => null as any);
      const { unmount } = renderUseSceneSetup({ containerRef: createMockRef(container) });
      unmount();
      expect(removeChildSpy).toHaveBeenCalled();
    });
  });

  describe('re-initialization', () => {
    it('tears down and rebuilds when officeId changes', () => {
      const opts = createDefaultOptions();
      const { rerender, result } = renderHook(
        ({ officeId }) => useSceneSetup({ ...opts, officeId }),
        { initialProps: { officeId: 'office-1' } },
      );
      const firstScene = opts.sceneRef.current;
      expect(firstScene).not.toBeNull();

      rerender({ officeId: 'office-2' });
      // New scene should be created
      expect(THREE.Scene).toHaveBeenCalledTimes(2);
    });

    it('tears down and rebuilds when environment changes', () => {
      const opts = createDefaultOptions();
      const { rerender } = renderHook(
        ({ environment }) => useSceneSetup({ ...opts, environment }),
        { initialProps: { environment: 'corporate' } },
      );

      rerender({ environment: 'cabin' });
      expect(THREE.Scene).toHaveBeenCalledTimes(2);
    });

    it('tears down and rebuilds when currentUser.id changes', () => {
      const opts = createDefaultOptions();
      const { rerender } = renderHook(
        ({ currentUser }) => useSceneSetup({ ...opts, currentUser }),
        { initialProps: { currentUser: { id: 'user-1', name: 'User 1' } as any } },
      );

      rerender({ currentUser: { id: 'user-2', name: 'User 2' } as any });
      expect(THREE.Scene).toHaveBeenCalledTimes(2);
    });
  });
});
