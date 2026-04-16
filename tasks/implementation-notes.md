# Implementation Notes

## Changes Made

### `packages/core/src/components/Avatar.tsx`
Two targeted changes:

1. **`switchAnimation` (lines 41-63):** Added a `walk → idle` fallback. When 'walk' is requested but no walk clip exists in the GLB, the function now tries 'idle' instead of doing nothing. Prevents T-pose when a GLB has some clips but is missing the walk animation.

2. **`loadGLTFIntoGroup` (lines 457-461):** Added `console.warn` in the `gltf.animations.length === 0` branch. The warning includes the model URL and a re-export instruction so the issue is self-diagnosable without source diving.

### `packages/core/src/__tests__/hooks/Avatar.test.ts`
New test file covering:
- `switchAnimation` walk→idle fallback (3 new cases)
- `switchAnimation` normal walk/idle cycling (4 cases — regression guard)
- `loadGLTFIntoGroup` emits `console.warn` when `animations.length === 0`
- `loadGLTFIntoGroup` does NOT warn when animations are present

### `packages/core/src/__tests__/setup.ts`
Three additive mock additions needed to test Avatar:
- `rotation.set` on `inlineMockGroup` (createAvatar calls group.rotation.set)
- `Box3` THREE export (loadGLTFIntoGroup uses new THREE.Box3())
- `clipAction` on AnimationMixer mock (needed for animation-clips-present test path)

## Key Decisions

**walk → idle fallback:** When 'walk' is missing, playing idle is semantically the least-bad option. Playing "any first available clip" was rejected (could play a death animation). T-posing while walking is worse UX than idle-while-walking.

**console.warn in loadGLTFIntoGroup:** This is the actionable location — it includes the URL so developers can identify which asset needs re-export. Adding a second warn inside switchAnimation (WeakSet-gated) was skipped as extra complexity with minimal extra diagnostic value.

**vi.hoisted() pattern for test:** Module-level `const gltfLoader = new GLTFLoader()` runs once at import time. Mocking GLTFLoader after import has no effect on the cached instance. The `vi.hoisted()` + `lastLoaderRef` pattern captures the instance created during module initialization.

## Verification
- 231/231 tests pass (`pnpm test`)
- Production build succeeds (`pnpm build`)
