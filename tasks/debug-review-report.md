# Debug Review Report — Third-Person Pitch + Shooting Fix

## Summary
Fix addresses the root cause correctly and the full test suite (244/244) passes. Orbit math is geometrically sound, the `third-person-front` bullet direction is right for the coordinate system, and changes are minimal and focused. One design-feel concern (vertical mouse inversion relative to first-person) and a couple of observations worth noting, but nothing blocks shipping.

## Compliance Score: 10/10

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | Spherical orbit addresses root cause (pitch encoded in position, not overwritten by lookAt) | Complete | `useKeyboardControls.ts:440-457` replaces fixed-height placement with `(yaw, pitch)`-derived sphere + `lookAt`. Pitch is preserved because it's geometric, exactly as diagnosed. |
| 2 | Orbit math correct: pitch=0 eye-level, positive pitch raises camera, radius constant at 3.5 | Complete | At pitch=0: `y = 1.4 + sin(0)*3.5 = 1.4` (eye-level). Positive pitch → higher y. Radius check: `sqrt(sin(yaw)^2*cos(pitch)^2 + sin(pitch)^2 + cos(yaw)^2*cos(pitch)^2) * 3.5 = sqrt(cos^2(pitch) + sin^2(pitch)) * 3.5 = 3.5` identically. Confirmed by test at line 626. |
| 3 | `side=-1` places camera in front of avatar | Complete | At yaw=0, side=-1: camera at `(pPos.x, 1.4, pPos.z - 3.5)`. Avatar's forward (from `-sin(yaw), 0, -cos(yaw)`) at yaw=0 is `(0, 0, -1)`, so `pPos.z - 3.5` is directly in front. Correct. |
| 4 | No regressions: first-person pitch/yaw, camera-mode toggle restore at line 143, yaw | Complete | First-person branch unchanged. Line 142-143 restore path still present and still re-applies pitch via `camera.rotation.set`. Yaw still syncs `playerYawRef = cameraYawRef` at line 434. |
| 5 | `fireBullet` front-view direction `(-sin(yaw), 0, -cos(yaw))` correct | Complete | Matches the `forward` vector derivation at `useKeyboardControls.ts:369`. Same coordinate convention. At yaw=0 → `(0, 0, -1)` which matches the direction W-key movement sends the avatar. |
| 6 | Tests adequate; `pnpm test` → 244/244 | Complete | Suite passes in 11.85s. 5 new orbit tests + 8 new shooting tests are meaningful — they assert concrete numeric outputs (camera.y, radius, bullet start position, direction vector). No trivial `toBeDefined` or `not.toBeNull` tautologies. |
| 7 | Changes minimal and focused | Complete | 17 lines changed in `useKeyboardControls.ts` (exact replacement of the broken block), signature + 12-line conditional in `useShooting.ts`, 3-line call-site update in `RoomScene.tsx`. No drive-by edits. |

## Issues Found

### Critical
None.

### Important
None.

### Minor
- **`packages/core/src/hooks/useKeyboardControls.ts:449-457`**: Pitch direction may feel inverted compared to first-person. In first-person, mouse-up → pitch goes positive → camera looks up. In this orbit implementation, mouse-up → pitch positive → camera rises *above* the avatar and `lookAt` aims it *downward* at the torso — so the user sees more ground, not more sky. This matches the diagnosis's stated acceptance criterion ("positive pitch raises the camera"), so it's not a defect per spec, but playtesters may find the vertical axis "inverted" when switching between first- and third-person. Worth a manual smoke test (criteria 10–12 from the diagnosis).
- **`packages/core/src/hooks/useShooting.ts:128`**: In `third-person-behind`, the raycaster origin is `camera.position` and the sight-line passes through the local avatar (local avatar is NOT in the `avatars` map, so it falls into `envObjects` via `scene.traverse`). Bullets aimed via `camera.getWorldDirection` will tend to impact the local avatar's back at distance ~3. This is pre-existing (the old y=2.2 camera had the same issue once the sight-line intersected the avatar mesh), but the new eye-level camera at pitch=0 aims directly at the torso, making the collision more consistent. Not introduced by this fix; flagging so it doesn't get lost.
- **`packages/core/src/hooks/useKeyboardControls.ts:224`**: In third-person, the `camera.rotation.set(...)` inside `handleMouseMove` is immediately overwritten by `computeMovement`'s `lookAt`. Harmless but wasteful — could early-return for third-person modes. Trivial.
- **`packages/core/src/__tests__/hooks/useKeyboardControls.test.ts:607-608`**: Tests work around a post-mount `useEffect` that resets `cameraModeRef.current` to `'first-person'` by overwriting `result.current.cameraModeRef.current = mode` after render. The workaround comment is clear and the test is correct, but this points to a subtle contract: callers must pass a pre-seeded `cameraModeRef` AND the hook syncs it from state via `useEffect`. Not a change-related bug; noting for future test-author reference.

## What Looks Good
- **Root-cause framing is precise**: the fix encodes pitch geometrically in `camera.position` so `lookAt` becomes idempotent rather than destructive. This is the correct mental model and the implementation notes articulate it well.
- **Minimal call-site churn**: only one `fireBullet` caller changed; the new params all come from refs already in scope.
- **`getWorldDirection` is preserved for behind-view**: no unnecessary duplication of behavior that already works.
- **Front-view origin moved to avatar torso**: a quiet but important correction — keeping the origin at the camera would have spawned bullets in front of the player (visually "behind" the facing direction). This is handled.
- **Test coverage is specific and falsifiable**: `camera.position.y).toBeCloseTo(1.4 + sin(0.5)*3.5, 5)` is the kind of exact assertion that would catch a regression to y=2.2 immediately. Radius test pins the geometry invariant. Direction test pins the coordinate convention. Behind-vs-front hemisphere test (`dzBehind * dzFront < 0`) is a clever way to assert sign flip without hardcoding sign.
- **`CameraMode` type exported from `useShooting`** matches the `CameraMode` shape in `@/types/room` — signature is self-documenting.
- **No dead code left behind**: `camHeight = 2.2` is fully removed; no orphan references.

## Test Coverage

| Area | Tests Exist | Coverage Notes |
|------|-------------|----------------|
| `third-person-behind` orbit geometry | Yes | Position y, sphere radius, behind-vs-front sign. Strong. |
| `third-person-front` orbit geometry | Yes | Position y (mirrored), sphere radius. Symmetrical with behind-view. |
| `third-person-front` shoot direction | Yes | yaw=0 and yaw=π/2 both asserted; bullet spawn position verified against explicit math. |
| `third-person-front` shoot origin | Yes | Asserts torso height (1.4) independent of avatar world y. |
| `third-person-front` bypasses camera | Yes | `camera.getWorldDirection` assert-not-called. |
| `first-person` shoot regression | Yes | `getWorldDirection` assert-called + bullet at camera position. |
| `third-person-behind` shoot regression | Yes | `getWorldDirection` assert-called + origin = camera, not avatar. |
| Camera-mode toggle restore path (line 143) | Partial | Existing cycling tests cover the state transition but don't assert `camera.rotation.set` is called with `(cameraPitchRef, cameraYawRef, 0, 'YXZ')` on the `first-person` re-entry. A regression here would be subtle. Not blocking — the existing path is untouched by this change. |
| Pitch-clamping after `computeMovement` | Yes (implicit) | The orbit tests use pitch=0.5, -0.3, 0.4 — all within `[-π/2, π/2]`. Clamping itself is covered at line 381. |
| Vertical inversion feel (see Minor #1) | No | Manual smoke test territory, not unit-testable. |

**Test Coverage Assessment**: Strong. The new tests are the kind that would have caught the original bug (they directly assert the invariants `lookAt` was destroying). Combined with the pre-existing 231 tests, the regression surface is well-guarded.

## Test Execution

| Check | Result | Details |
|-------|--------|---------|
| Test command discovered | Yes (`pnpm test`) | From the user's prompt criterion 6; confirmed by `package.json` and `packages/core/package.json` `scripts.test` pointing at `vitest run`. |
| Test suite run | Passed (244/244) | Ran in 11.85s, all 11 test files pass. |
| TDD evidence in implementation notes | Yes | `implementation-notes.md` lines 24–27 state "Full suite: 244/244 pass" with specific new-test descriptions. Matches what the run produced. |

**Test Execution Assessment**: Everything green, evidence consistent with implementation notes, no timeouts or flaky behavior observed.

## Implementation Decision Review

| Decision | Documented | Sound | Flags |
|----------|------------|-------|-------|
| Spherical orbit over separate `aimDirectionRef` | Yes | Yes | The geometry-encodes-pitch argument is right. An `aimDirectionRef` would have required keeping two sources of truth in sync. |
| Flat direction (y=0) in `third-person-front` | Yes | Yes | Matches the user's stated preference per the original debug-questions answers. Signature already admits pitch if product reverses course. |
| No clamp tightening (leave `[-π/2, π/2]`) | Yes | Partially | At extreme pitches, `cos(pitch) → 0` collapses horizontal offset and the camera passes through the avatar from directly above/below. The diagnosis flagged this as a clipping risk. Leaving the clamp wide is defensible (usable at extremes, cheaper code) but will show visual issues; worth a follow-up ticket if playtesters report clipping. Not a blocker. |
| Drop `camHeight = 2.2` baseline offset | Yes | Yes | Diagnosis called out the feel shift; notes acknowledge the one-line remediation is available. Accepting the shift is a valid product call, especially since the new eye-level default is more conventional for orbit cameras. |
| Use `(-sin(yaw), 0, -cos(yaw))` direction in front-view | Yes | Yes | Matches `useKeyboardControls.ts:369` exactly, so forward-motion and forward-shooting share one coordinate convention. |
| Move shoot origin to avatar torso in front-view | Yes | Yes | Critical detail — keeping origin at camera would have spawned bullets behind the target direction. Implementation notes call this out implicitly; the effect is correct. |

**Decision Assessment**: All non-obvious decisions are documented and defensible. The one decision I'd challenge (no clamp tightening) is explicitly acknowledged as a follow-up contingency rather than dismissed.

## Recommendations
1. **Manual smoke test** the three scenarios from the diagnosis (criteria 10–12). The unit tests validate math but not feel; specifically verify the vertical inversion concern (Minor #1) is acceptable to the product owner.
2. **Consider a baseline pitch offset** (`+0.23` rad, per the diagnosis note) if playtesters report the new pitch-0 view feels too low. One-line change to `useKeyboardControls.ts:442` would restore the old default angle.
3. **Follow-up ticket**: Confetti (`RoomScene.tsx:446, 459`) still spawns at `camera.position` in third-person. In front-view this is now visibly behind the avatar. Not in scope for this bug but worth a linked issue — the same mode-aware origin fix applied to `fireBullet` would apply here.
4. **Follow-up ticket (optional)**: Tighten third-person pitch clamp to `[-π/3, π/3]` if clipping-through-avatar at extreme angles is reported. Clamp site: `useKeyboardControls.ts:223`.
5. **No code changes required to ship this fix.**
