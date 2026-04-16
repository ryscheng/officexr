# Test Patterns — officexr/packages/core

## Global THREE mock (setup.ts)
- All THREE constructors mocked via `vi.mock('three', () => {...})`
- `inlineMockGroup()` provides the Group mock — rotation NOW has `.set()` (added 2026-04-16)
- `Box3` mock added 2026-04-16: returns `{ setFromObject: vi.fn().mockReturnThis(), min: {y:0}, max: {y:1} }`
- `AnimationMixer` mock: `{ update, stopAllAction, clipAction }` (clipAction added 2026-04-16)
- Constructors must use regular `function` expressions (not arrow fns) to be `new`-able

## Avatar module testing (Avatar.test.ts)
- Uses `vi.unmock('@/components/Avatar')` to get real Avatar code (not the mock from setup.ts)
- Avatar.tsx has a module-level `gltfLoader` singleton — created at module init from GLTFLoader mock
- To intercept loader calls: use `vi.hoisted()` to create a ref, store loader instance in the mock factory
- Pattern:
  ```ts
  const { lastLoaderRef } = vi.hoisted(() => {
    const lastLoaderRef = { current: { load: (() => {}) as ReturnType<typeof vi.fn> } };
    return { lastLoaderRef };
  });
  vi.mock('three/addons/loaders/GLTFLoader.js', () => ({
    GLTFLoader: vi.fn().mockImplementation(function() {
      const instance = { load: vi.fn() };
      lastLoaderRef.current = instance;
      return instance;
    }),
  }));
  // In test: lastLoaderRef.current.load.mock.calls[0]
  ```
- Dynamic `import('@/components/Avatar')` inside tests returns the CACHED module — the gltfLoader
  singleton is NOT re-created. Use the lastLoaderRef pattern instead.

## vi.hoisted() usage
- Needed when a variable must be accessible inside `vi.mock()` factories (which are hoisted before imports)
- Returns values that are available in hoisted scope

## vi.clearAllMocks() behavior
- Clears call history, instances, results
- Does NOT clear `mockImplementation` — implementations survive across tests
- Use in `beforeEach` to reset call counts

## Module-level singletons
- Avatar.tsx: `const gltfLoader = new GLTFLoader()` runs once at import time
- Cannot be re-created by changing mock implementation after import
