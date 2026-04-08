import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as THREE from 'three';
import { useKeyboardControls } from '@/hooks/useKeyboardControls';
import { switchAnimation } from '@/components/Avatar';

// ---------------------------------------------------------------------------
// Patch the mocked THREE.Vector3 so it also has `sub` (the global setup omits
// it, but computeMovement calls `direction.sub(forward)` for S/A keys).
// ---------------------------------------------------------------------------
const OriginalVector3 = THREE.Vector3 as unknown as vi.Mock;
const originalV3Impl = OriginalVector3.getMockImplementation()!;

function mockVector3(x = 0, y = 0, z = 0) {
  const v = originalV3Impl(x, y, z);
  v.sub = vi.fn((o: any) => {
    v.x -= o.x;
    v.y -= o.y;
    v.z -= o.z;
    return v;
  });
  return v;
}

// Override Vector3 constructor to include `sub`
(THREE.Vector3 as unknown as vi.Mock).mockImplementation(
  function (this: any, x?: number, y?: number, z?: number) {
    return mockVector3(x ?? 0, y ?? 0, z ?? 0);
  },
);

// Save references to ALL constructor implementations before clearAllMocks wipes them
const savedWebGLRendererImpl = (THREE.WebGLRenderer as unknown as vi.Mock).getMockImplementation()!;
const savedPerspectiveCameraImpl = (THREE.PerspectiveCamera as unknown as vi.Mock).getMockImplementation()!;
const savedSceneImpl = (THREE.Scene as unknown as vi.Mock).getMockImplementation()!;
const savedOrthographicCameraImpl = (THREE.OrthographicCamera as unknown as vi.Mock).getMockImplementation()!;
const savedGroupImpl = (THREE.Group as unknown as vi.Mock).getMockImplementation()!;

// ---------------------------------------------------------------------------
// Helper: default refs / setters that every call of the hook needs
// ---------------------------------------------------------------------------
function createDefaultOptions(overrides: Partial<Parameters<typeof useKeyboardControls>[0]> = {}) {
  return {
    keysRef: { current: {} as { [key: string]: boolean } },
    cameraModeRef: { current: 'first-person' as any },
    chatVisibleRef: { current: false },
    motionActiveRef: { current: false },
    followingUserIdRef: { current: null as string | null },
    setFollowingUserId: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper: render the hook with optional option overrides
// ---------------------------------------------------------------------------
function renderUseKeyboardControls(overrides?: Partial<Parameters<typeof useKeyboardControls>[0]>) {
  const options = createDefaultOptions(overrides);
  const hookReturn = renderHook(() => useKeyboardControls(options));
  return { ...hookReturn, options };
}

// ---------------------------------------------------------------------------
// Helpers for Three objects used by registerInputListeners / computeMovement.
// These call the saved mock implementations directly rather than using `new`,
// because vi.clearAllMocks() in beforeEach wipes mockImplementation.
// ---------------------------------------------------------------------------
function createRenderer() {
  const renderer = savedWebGLRendererImpl();
  renderer.domElement.requestPointerLock = vi.fn();
  renderer.xr.isPresenting = false;
  return renderer as any;
}

function createCamera() {
  const cam = savedPerspectiveCameraImpl() as any;
  // The hook calls camera.rotation.set(...) which the mock doesn't include
  cam.rotation.set = vi.fn((x: number, y: number, z: number, order?: string) => {
    cam.rotation.x = x;
    cam.rotation.y = y;
    cam.rotation.z = z;
    if (order) cam.rotation.order = order;
  });
  return cam;
}

function createScene() {
  return savedSceneImpl() as any;
}

function createOrthoCamera() {
  return savedOrthographicCameraImpl() as any;
}

function createLocalAvatar() {
  return savedGroupImpl() as any;
}

function createAnimState() {
  return {
    mixer: { update: vi.fn(), stopAllAction: vi.fn() },
    actions: new Map([
      ['idle', { play: vi.fn(), stop: vi.fn(), fadeIn: vi.fn().mockReturnThis(), reset: vi.fn().mockReturnThis() }],
      ['walk', { play: vi.fn(), stop: vi.fn(), fadeIn: vi.fn().mockReturnThis(), reset: vi.fn().mockReturnThis() }],
    ]),
    activeAction: null,
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('useKeyboardControls', () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();

    // Restore the Vector3 mock implementation since clearAllMocks wipes it
    (THREE.Vector3 as unknown as vi.Mock).mockImplementation(
      function (this: any, x?: number, y?: number, z?: number) {
        return mockVector3(x ?? 0, y ?? 0, z ?? 0);
      },
    );

    cleanup = undefined;
  });

  afterEach(() => {
    if (cleanup) cleanup();
  });

  // ── initial state ────────────────────────────────────────────────────────
  describe('initial state', () => {
    it('starts with cameraMode = "first-person"', () => {
      const { result } = renderUseKeyboardControls();
      expect(result.current.cameraMode).toBe('first-person');
    });

    it('starts with is2DMode = false', () => {
      const { result } = renderUseKeyboardControls();
      expect(result.current.is2DMode).toBe(false);
    });

    it('starts with showControls = false', () => {
      const { result } = renderUseKeyboardControls();
      expect(result.current.showControls).toBe(false);
    });

    it('starts with mouseLockActive = false', () => {
      const { result } = renderUseKeyboardControls();
      expect(result.current.mouseLockActive).toBe(false);
    });
  });

  // ── camera mode cycling ──────────────────────────────────────────────────
  describe('camera mode cycling', () => {
    it('cycles first-person → third-person-behind on C key', () => {
      const { result, options } = renderUseKeyboardControls();
      const renderer = createRenderer();
      const camera = createCamera();

      act(() => {
        cleanup = result.current.registerInputListeners(
          renderer, camera, createScene(), createOrthoCamera(), { current: 10 }, vi.fn(),
        );
      });

      act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' })); });

      expect(result.current.cameraMode).toBe('third-person-behind');
      expect(options.cameraModeRef.current).toBe('third-person-behind');
    });

    it('cycles third-person-behind → third-person-front on C key', () => {
      const { result, options } = renderUseKeyboardControls();
      const renderer = createRenderer();
      const camera = createCamera();

      act(() => {
        cleanup = result.current.registerInputListeners(
          renderer, camera, createScene(), createOrthoCamera(), { current: 10 }, vi.fn(),
        );
      });

      // first-person → third-person-behind
      act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' })); });
      // third-person-behind → third-person-front
      act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' })); });

      expect(result.current.cameraMode).toBe('third-person-front');
      expect(options.cameraModeRef.current).toBe('third-person-front');
    });

    it('cycles third-person-front → first-person on C key', () => {
      const { result } = renderUseKeyboardControls();
      const renderer = createRenderer();
      const camera = createCamera();

      act(() => {
        cleanup = result.current.registerInputListeners(
          renderer, camera, createScene(), createOrthoCamera(), { current: 10 }, vi.fn(),
        );
      });

      // first → behind → front → first
      act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' })); });
      act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' })); });
      act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' })); });

      expect(result.current.cameraMode).toBe('first-person');
    });

    it('ignores C key when chat is visible', () => {
      const { result, options } = renderUseKeyboardControls();
      const renderer = createRenderer();
      const camera = createCamera();

      act(() => {
        cleanup = result.current.registerInputListeners(
          renderer, camera, createScene(), createOrthoCamera(), { current: 10 }, vi.fn(),
        );
      });

      options.chatVisibleRef.current = true;
      act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' })); });

      expect(result.current.cameraMode).toBe('first-person');
    });

    it('updates cameraModeRef in sync with state', () => {
      const { result, options } = renderUseKeyboardControls();
      const renderer = createRenderer();
      const camera = createCamera();

      act(() => {
        cleanup = result.current.registerInputListeners(
          renderer, camera, createScene(), createOrthoCamera(), { current: 10 }, vi.fn(),
        );
      });

      act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' })); });

      // The ref is updated eagerly inside setCameraMode updater
      expect(options.cameraModeRef.current).toBe('third-person-behind');
      // ...and the state matches
      expect(result.current.cameraMode).toBe('third-person-behind');
    });
  });

  // ── 2D mode toggle ──────────────────────────────────────────────────────
  describe('2D mode toggle', () => {
    it('toggles is2DMode on V key', () => {
      const { result } = renderUseKeyboardControls();
      const renderer = createRenderer();
      const camera = createCamera();

      act(() => {
        cleanup = result.current.registerInputListeners(
          renderer, camera, createScene(), createOrthoCamera(), { current: 10 }, vi.fn(),
        );
      });

      act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v' })); });
      expect(result.current.is2DMode).toBe(true);

      act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v' })); });
      expect(result.current.is2DMode).toBe(false);
    });

    it('exits pointer lock when entering 2D mode', () => {
      const { result } = renderUseKeyboardControls();
      const renderer = createRenderer();
      const camera = createCamera();

      // Pretend the pointer is already locked
      Object.defineProperty(document, 'pointerLockElement', {
        value: renderer.domElement,
        configurable: true,
        writable: true,
      });

      act(() => {
        cleanup = result.current.registerInputListeners(
          renderer, camera, createScene(), createOrthoCamera(), { current: 10 }, vi.fn(),
        );
      });

      act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v' })); });

      expect(document.exitPointerLock).toHaveBeenCalled();

      // Reset
      Object.defineProperty(document, 'pointerLockElement', {
        value: null,
        configurable: true,
        writable: true,
      });
    });

    it('updates is2DModeRef in sync with state', () => {
      const { result } = renderUseKeyboardControls();
      const renderer = createRenderer();
      const camera = createCamera();

      act(() => {
        cleanup = result.current.registerInputListeners(
          renderer, camera, createScene(), createOrthoCamera(), { current: 10 }, vi.fn(),
        );
      });

      act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v' })); });

      expect(result.current.is2DMode).toBe(true);
      expect(result.current.is2DModeRef.current).toBe(true);
    });
  });

  // ── showControls toggle ──────────────────────────────────────────────────
  describe('showControls toggle', () => {
    it('toggles showControls on ? key', () => {
      const { result } = renderUseKeyboardControls();
      const renderer = createRenderer();
      const camera = createCamera();

      act(() => {
        cleanup = result.current.registerInputListeners(
          renderer, camera, createScene(), createOrthoCamera(), { current: 10 }, vi.fn(),
        );
      });

      act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' })); });
      expect(result.current.showControls).toBe(true);

      act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' })); });
      expect(result.current.showControls).toBe(false);
    });
  });

  // ── pointer lock ─────────────────────────────────────────────────────────
  describe('pointer lock', () => {
    it('requests pointer lock on canvas click', () => {
      const { result } = renderUseKeyboardControls();
      const renderer = createRenderer();
      const camera = createCamera();

      act(() => {
        cleanup = result.current.registerInputListeners(
          renderer, camera, createScene(), createOrthoCamera(), { current: 10 }, vi.fn(),
        );
      });

      act(() => { renderer.domElement.dispatchEvent(new MouseEvent('click')); });

      expect(renderer.domElement.requestPointerLock).toHaveBeenCalled();
    });

    it('does not request pointer lock in 2D mode', () => {
      const { result } = renderUseKeyboardControls();
      const renderer = createRenderer();
      const camera = createCamera();

      act(() => {
        cleanup = result.current.registerInputListeners(
          renderer, camera, createScene(), createOrthoCamera(), { current: 10 }, vi.fn(),
        );
      });

      // Switch to 2D
      act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v' })); });

      renderer.domElement.requestPointerLock.mockClear();
      act(() => { renderer.domElement.dispatchEvent(new MouseEvent('click')); });

      expect(renderer.domElement.requestPointerLock).not.toHaveBeenCalled();
    });
  });

  // ── mouse movement ───────────────────────────────────────────────────────
  describe('mouse movement', () => {
    it('clamps cameraPitch to [-PI/2, PI/2]', () => {
      const { result } = renderUseKeyboardControls();
      const renderer = createRenderer();
      const camera = createCamera();

      act(() => {
        cleanup = result.current.registerInputListeners(
          renderer, camera, createScene(), createOrthoCamera(), { current: 10 }, vi.fn(),
        );
      });

      // Simulate pointer lock being active
      Object.defineProperty(document, 'pointerLockElement', {
        value: renderer.domElement,
        configurable: true,
        writable: true,
      });

      // Huge downward mouse movement that would exceed PI/2
      act(() => {
        renderer.domElement.dispatchEvent(
          new MouseEvent('mousemove', { movementX: 0, movementY: 5000 }),
        );
      });

      expect(result.current.cameraPitchRef.current).toBeGreaterThanOrEqual(-Math.PI / 2);
      expect(result.current.cameraPitchRef.current).toBeLessThanOrEqual(Math.PI / 2);

      // Huge upward movement
      act(() => {
        renderer.domElement.dispatchEvent(
          new MouseEvent('mousemove', { movementX: 0, movementY: -10000 }),
        );
      });

      expect(result.current.cameraPitchRef.current).toBeGreaterThanOrEqual(-Math.PI / 2);
      expect(result.current.cameraPitchRef.current).toBeLessThanOrEqual(Math.PI / 2);

      // Reset
      Object.defineProperty(document, 'pointerLockElement', {
        value: null,
        configurable: true,
        writable: true,
      });
    });
  });

  // ── computeMovement() – 3D mode ─────────────────────────────────────────
  describe('computeMovement() - 3D mode', () => {
    it('returns moved=false when no keys pressed', () => {
      const { result } = renderUseKeyboardControls();
      const camera = createCamera();

      const { moved } = result.current.computeMovement(
        camera, null, null, undefined, 3, 0.15,
      );

      expect(moved).toBe(false);
    });

    it('returns moved=true when W key pressed', () => {
      const opts = createDefaultOptions();
      opts.keysRef.current['w'] = true;

      const { result } = renderUseKeyboardControls({
        keysRef: opts.keysRef,
      });
      const camera = createCamera();

      const { moved } = result.current.computeMovement(
        camera, null, null, undefined, 3, 0.15,
      );

      expect(moved).toBe(true);
    });

    it('clamps position to [-14.5, 14.5] bounds', () => {
      const opts = createDefaultOptions();
      opts.keysRef.current['w'] = true;

      const { result } = renderUseKeyboardControls({
        keysRef: opts.keysRef,
      });
      const camera = createCamera();

      // Put camera near the edge
      camera.position.x = 14.4;
      camera.position.z = 14.4;

      // Move with a huge speed to go past bounds
      result.current.computeMovement(camera, null, null, undefined, 3, 500);

      expect(camera.position.x).toBeLessThanOrEqual(14.5);
      expect(camera.position.x).toBeGreaterThanOrEqual(-14.5);
      expect(camera.position.z).toBeLessThanOrEqual(14.5);
      expect(camera.position.z).toBeGreaterThanOrEqual(-14.5);
    });

    it('cancels follow mode on any movement', () => {
      const opts = createDefaultOptions();
      opts.keysRef.current['w'] = true;
      opts.followingUserIdRef.current = 'user-42';

      const { result } = renderUseKeyboardControls({
        keysRef: opts.keysRef,
        followingUserIdRef: opts.followingUserIdRef,
        setFollowingUserId: opts.setFollowingUserId,
      });
      const camera = createCamera();

      result.current.computeMovement(camera, null, null, undefined, 3, 0.15);

      expect(opts.setFollowingUserId).toHaveBeenCalledWith(null);
    });

    it('switches avatar animation to walk when moving', () => {
      const opts = createDefaultOptions();
      opts.keysRef.current['w'] = true;

      const { result } = renderUseKeyboardControls({
        keysRef: opts.keysRef,
      });
      const camera = createCamera();
      const animState = createAnimState();

      result.current.computeMovement(camera, createLocalAvatar(), animState, undefined, 3, 0.15);

      expect(switchAnimation).toHaveBeenCalledWith(animState, 'walk');
    });

    it('switches avatar animation to idle when not moving', () => {
      const { result } = renderUseKeyboardControls();
      const camera = createCamera();
      const animState = createAnimState();

      result.current.computeMovement(camera, createLocalAvatar(), animState, undefined, 3, 0.15);

      expect(switchAnimation).toHaveBeenCalledWith(animState, 'idle');
    });
  });

  // ── computeMovement() – follow mode ──────────────────────────────────────
  describe('computeMovement() - follow mode', () => {
    it('reports moved=true when following', () => {
      const opts = createDefaultOptions();
      opts.followingUserIdRef.current = 'user-42';

      const { result } = renderUseKeyboardControls({
        followingUserIdRef: opts.followingUserIdRef,
      });
      const camera = createCamera();

      // Place camera far from the follow target so the hook repositions it
      camera.position.set(10, 1.6, 10);

      const followTarget = { position: mockVector3(0, 0, 0) };

      const { moved } = result.current.computeMovement(
        camera, null, null, followTarget, 3, 0.15,
      );

      expect(moved).toBe(true);
    });
  });

  // ── emoji keys ───────────────────────────────────────────────────────────
  describe('emoji keys', () => {
    it('fires onEmojiKey for keys 1-5 when chat not visible', () => {
      const { result } = renderUseKeyboardControls();
      const renderer = createRenderer();
      const camera = createCamera();
      const onEmojiKey = vi.fn();

      act(() => {
        cleanup = result.current.registerInputListeners(
          renderer, camera, createScene(), createOrthoCamera(), { current: 10 }, onEmojiKey,
        );
      });

      for (const key of ['1', '2', '3', '4', '5']) {
        act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key })); });
      }

      expect(onEmojiKey).toHaveBeenCalledTimes(5);
      expect(onEmojiKey).toHaveBeenCalledWith('1');
      expect(onEmojiKey).toHaveBeenCalledWith('2');
      expect(onEmojiKey).toHaveBeenCalledWith('3');
      expect(onEmojiKey).toHaveBeenCalledWith('4');
      expect(onEmojiKey).toHaveBeenCalledWith('5');
    });

    it('does not fire onEmojiKey when chat visible', () => {
      const { result, options } = renderUseKeyboardControls();
      const renderer = createRenderer();
      const camera = createCamera();
      const onEmojiKey = vi.fn();

      act(() => {
        cleanup = result.current.registerInputListeners(
          renderer, camera, createScene(), createOrthoCamera(), { current: 10 }, onEmojiKey,
        );
      });

      options.chatVisibleRef.current = true;

      for (const key of ['1', '2', '3', '4', '5']) {
        act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key })); });
      }

      expect(onEmojiKey).not.toHaveBeenCalled();
    });
  });

  // ── cleanup ──────────────────────────────────────────────────────────────
  describe('cleanup', () => {
    it('removes all event listeners on cleanup', () => {
      const { result } = renderUseKeyboardControls();
      const renderer = createRenderer();
      const camera = createCamera();

      const windowRemoveSpy = vi.spyOn(window, 'removeEventListener');
      const documentRemoveSpy = vi.spyOn(document, 'removeEventListener');
      const canvasRemoveSpy = vi.spyOn(renderer.domElement, 'removeEventListener');

      let cleanupFn: () => void;
      act(() => {
        cleanupFn = result.current.registerInputListeners(
          renderer, camera, createScene(), createOrthoCamera(), { current: 10 }, vi.fn(),
        );
      });

      act(() => { cleanupFn(); });

      // Window listeners: keydown, keyup
      expect(windowRemoveSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
      expect(windowRemoveSpy).toHaveBeenCalledWith('keyup', expect.any(Function));

      // Document listeners: pointerlockchange
      expect(documentRemoveSpy).toHaveBeenCalledWith('pointerlockchange', expect.any(Function));

      // Canvas listeners: click, mousemove, touchstart, touchmove, touchend, wheel
      expect(canvasRemoveSpy).toHaveBeenCalledWith('click', expect.any(Function));
      expect(canvasRemoveSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
      expect(canvasRemoveSpy).toHaveBeenCalledWith('touchstart', expect.any(Function));
      expect(canvasRemoveSpy).toHaveBeenCalledWith('touchmove', expect.any(Function));
      expect(canvasRemoveSpy).toHaveBeenCalledWith('touchend', expect.any(Function));
      expect(canvasRemoveSpy).toHaveBeenCalledWith('wheel', expect.any(Function));

      windowRemoveSpy.mockRestore();
      documentRemoveSpy.mockRestore();
      canvasRemoveSpy.mockRestore();

      // Prevent afterEach from calling cleanup again
      cleanup = undefined;
    });
  });
});
