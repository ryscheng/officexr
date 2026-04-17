/**
 * Unit tests for Avatar.tsx — real implementation (not the global mock).
 *
 * The global setup.ts mocks the entire @/components/Avatar module, so we
 * must call vi.unmock before importing to get the real code under test.
 *
 * Two behaviours are exercised:
 *  1. switchAnimation — 'walk' with no walk clip falls back to 'idle' instead
 *     of leaving the avatar in T-pose.
 *  2. loadGLTFIntoGroup — emits console.warn when gltf.animations.length === 0
 *     so the issue is self-diagnosable.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Override the global Avatar mock so we exercise the real module.
vi.unmock('@/components/Avatar');

// Also unmock 'three' for AnimationAction stubs used below — but three IS
// globally mocked in setup.ts with only the constructors the other tests need.
// We do NOT unmock 'three' here; instead we import AvatarAnimationState as a
// plain TypeScript type and build the test objects manually.

// GLTFLoader is not mocked globally — mock it here so loadGLTFIntoGroup is
// exercisable without a real HTTP fetch.
//
// We store the last created loader instance in `lastLoaderRef.current` so tests
// can inspect or invoke the `load` callback that Avatar.tsx registered.
// This avoids the module-caching problem: Avatar.tsx's `gltfLoader` singleton
// is created once at module init time (from the mock below), and later
// `mockImplementation` calls on the constructor don't affect the already-
// constructed singleton.
//
// `vi.hoisted` runs before the vi.mock factory (which is itself hoisted), so
// the variable is in scope when the factory executes.
const { lastLoaderRef } = vi.hoisted(() => {
  const lastLoaderRef = { current: { load: (() => {}) as ReturnType<typeof vi.fn> } };
  return { lastLoaderRef };
});

vi.mock('three/addons/loaders/GLTFLoader.js', () => ({
  GLTFLoader: vi.fn().mockImplementation(function () {
    const instance = { load: vi.fn() };
    lastLoaderRef.current = instance;
    return instance;
  }),
}));

import { switchAnimation, createAvatar } from '@/components/Avatar';
import type { AvatarAnimationState } from '@/components/Avatar';

// ---------------------------------------------------------------------------
// Helper: build a minimal AvatarAnimationState without relying on THREE mocks
// ---------------------------------------------------------------------------
function makeAction() {
  return {
    play: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    fadeIn: vi.fn().mockReturnThis(),
    fadeOut: vi.fn().mockReturnThis(),
    reset: vi.fn().mockReturnThis(),
  };
}

function makeAnimState(actionNames: string[]): AvatarAnimationState {
  const actions = new Map<string, any>();
  for (const name of actionNames) {
    actions.set(name, makeAction());
  }
  return {
    mixer: { update: vi.fn(), stopAllAction: vi.fn() } as any,
    actions,
    activeAction: null,
  };
}

// ---------------------------------------------------------------------------
describe('switchAnimation', () => {
  // ── walk fallback ────────────────────────────────────────────────────────
  describe('walk clip missing — idle fallback', () => {
    it('plays the idle action when walk is requested but no walk clip exists', () => {
      // animState has only 'idle', not 'walk'
      const animState = makeAnimState(['idle']);
      const idleAction = animState.actions.get('idle')!;

      switchAnimation(animState, 'walk');

      // idle should have been reset + played
      expect(idleAction.reset).toHaveBeenCalled();
      expect(idleAction.play).toHaveBeenCalled();
      expect(animState.activeAction).toBe(idleAction);
    });

    it('does not crash when neither walk nor idle clip exists', () => {
      const animState = makeAnimState([]);
      expect(() => switchAnimation(animState, 'walk')).not.toThrow();
      expect(animState.activeAction).toBeNull();
    });

    it('fades out existing action before playing idle fallback', () => {
      const animState = makeAnimState(['idle', 'some-other']);
      const otherAction = animState.actions.get('some-other')!;
      const idleAction = animState.actions.get('idle')!;

      // Pretend 'some-other' is already playing
      animState.activeAction = otherAction as any;

      switchAnimation(animState, 'walk');

      expect(otherAction.fadeOut).toHaveBeenCalledWith(0.3);
      expect(idleAction.reset).toHaveBeenCalled();
      expect(idleAction.play).toHaveBeenCalled();
    });
  });

  // ── normal operation (no regression) ────────────────────────────────────
  describe('normal walk/idle cycling', () => {
    it('plays walk when walk clip exists', () => {
      const animState = makeAnimState(['idle', 'walk']);
      const walkAction = animState.actions.get('walk')!;

      switchAnimation(animState, 'walk');

      expect(walkAction.reset).toHaveBeenCalled();
      expect(walkAction.play).toHaveBeenCalled();
      expect(animState.activeAction).toBe(walkAction);
    });

    it('plays idle when idle clip exists', () => {
      const animState = makeAnimState(['idle', 'walk']);
      const idleAction = animState.actions.get('idle')!;

      switchAnimation(animState, 'idle');

      expect(idleAction.reset).toHaveBeenCalled();
      expect(idleAction.play).toHaveBeenCalled();
      expect(animState.activeAction).toBe(idleAction);
    });

    it('does not restart action that is already active', () => {
      const animState = makeAnimState(['idle', 'walk']);
      const walkAction = animState.actions.get('walk')!;

      // Pre-set activeAction to walk
      animState.activeAction = walkAction as any;

      switchAnimation(animState, 'walk');

      // reset / play should NOT be called again
      expect(walkAction.reset).not.toHaveBeenCalled();
      expect(walkAction.play).not.toHaveBeenCalled();
    });

    it('fades idle to bind pose when idle clip is missing', () => {
      const animState = makeAnimState(['walk']);
      const walkAction = animState.actions.get('walk')!;
      animState.activeAction = walkAction as any;

      switchAnimation(animState, 'idle');

      expect(walkAction.fadeOut).toHaveBeenCalledWith(0.5);
      expect(animState.activeAction).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
describe('loadGLTFIntoGroup — no animation clips', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits console.warn when GLTF has no animation clips', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Minimal THREE.Scene stub — just needs scene.add
    // (Box3 is already mocked in setup.ts with setFromObject/min/max)
    const scene = { add: vi.fn(), remove: vi.fn() } as any;
    const customization = {
      modelUrl: 'https://example.com/skin.glb',
      bodyColor: '#3498db',
      skinColor: '#ffdbac',
      style: 'default' as const,
      accessories: [] as any[],
    };
    const userData = {
      id: 'u1',
      name: 'Test User',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      customization,
    };

    const onAnimationsReady = vi.fn();
    createAvatar(scene, userData, onAnimationsReady);

    // Capture the onLoad callback that loadGLTFIntoGroup registered with the
    // module-level gltfLoader singleton (created when Avatar.tsx was first imported).
    // `lastLoaderRef.current` was populated by the GLTFLoader mock at that time.
    expect(lastLoaderRef.current.load).toHaveBeenCalled();
    const [_url, onLoad] = lastLoaderRef.current.load.mock.calls[0];

    const mockGltf = {
      scene: {
        // minimal THREE.Object3D stub for scaling logic
        scale: { setScalar: vi.fn() },
        position: { y: 0 },
      },
      animations: [],
    };

    onLoad(mockGltf);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Avatar]'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('no animation clips'),
    );
    // onAnimationsReady should still be called with null
    expect(onAnimationsReady).toHaveBeenCalledWith(null);

    warnSpy.mockRestore();
  });

  it('does NOT warn when GLTF has animation clips', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // AnimationMixer and Box3 are already mocked in setup.ts.

    const scene = { add: vi.fn(), remove: vi.fn() } as any;
    const customization = {
      modelUrl: 'https://example.com/skin-with-anims.glb',
      bodyColor: '#3498db',
      skinColor: '#ffdbac',
      style: 'default' as const,
      accessories: [] as any[],
    };
    const userData = {
      id: 'u2',
      name: 'Animated User',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      customization,
    };

    const onAnimationsReady = vi.fn();
    createAvatar(scene, userData, onAnimationsReady);

    expect(lastLoaderRef.current.load).toHaveBeenCalled();
    const [_url, onLoad] = lastLoaderRef.current.load.mock.calls[0];

    const mockGltf = {
      scene: {
        scale: { setScalar: vi.fn() },
        position: { y: 0 },
      },
      animations: [{ name: 'Walk' }, { name: 'Idle' }],
    };

    onLoad(mockGltf);

    // No Avatar-specific warn should have been emitted
    const avatarWarns = warnSpy.mock.calls.filter(args =>
      typeof args[0] === 'string' && args[0].includes('[Avatar]'),
    );
    expect(avatarWarns).toHaveLength(0);

    warnSpy.mockRestore();
  });
});
