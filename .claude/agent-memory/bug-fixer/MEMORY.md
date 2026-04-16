# Bug Fixer Agent Memory — officexr

## Index

- `build-commands.md` — test commands, test framework, file locations
- `test-patterns.md` — THREE mock patterns, vi.hoisted usage, Avatar module testing, module singleton pattern

## Key facts
- Repo: /home/user/officexr
- Package under test: packages/core
- Test command: `cd /home/user/officexr/packages/core && pnpm test`
- 244 tests passing as of 2026-04-16 (pitch/shooting bug fix)

## Pitfall: cameraModeRef useEffect override in useKeyboardControls tests
- The hook does `useEffect(() => { cameraModeRef.current = cameraMode; }, [cameraMode])`
- This syncs the external ref back to 'first-person' after render
- When testing third-person computeMovement, set `result.current.cameraModeRef.current = mode`
  AFTER renderHook() to override the effect — not just in the options object passed to the hook

## useShooting mock needs
- `camera.getWorldDirection` is NOT in the global THREE PerspectiveCamera mock
- Must add it manually: `cam.getWorldDirection = vi.fn((v) => { v.x=...; v.y=...; v.z=...; return v; })`
