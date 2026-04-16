# Implementation Notes — Pitch + Shooting Fix (Third-Person View)

## Changes

### useKeyboardControls.ts
Replaced fixed-height, pitch-agnostic camera placement with spherical orbit. Camera position is now derived from `(yaw, pitch)` using `cos(pitch)` to shrink the horizontal radius and `sin(pitch)` to raise/lower height. `lookAt` after repositioning is intentional and correct — pitch is encoded geometrically in `camera.position`, so the rotation built by `lookAt` preserves the user's pitch each frame instead of discarding it.

Removed `camHeight = 2.2`. At `pitch = 0` the camera now sits at `y = 1.4` (eye-level with avatar) vs. old `y = 2.2`. This is a feel shift — a one-line baseline pitch offset (`effectivePitch = pitch + 0.23`) can restore the old default angle if playtesters prefer it.

### useShooting.ts
Added `CameraMode` export type. `fireBullet` now accepts `cameraMode`, `playerYaw`, `playerPosition`. In `third-person-front`, direction is `(-sin(yaw), 0, -cos(yaw))` (avatar facing) and origin is the avatar torso — bypassing the backward-facing camera. All other modes use `camera.getWorldDirection` and `camera.position` unchanged.

### RoomScene.tsx
Updated the single `fireBullet` call site to pass the three new params from refs already in scope.

## Key Decisions

- **Spherical orbit over separate aim vector**: Encoding pitch in camera position is simpler than an `aimDirectionRef`. The geometry is self-consistent: wherever the camera is positioned, `lookAt` produces the correct rotation pointing back at the avatar.

- **Flat direction in third-person-front**: `y = 0` (no pitch) matches the user's stated preference — "shoot in avatar's facing direction". Signature already accepts pitch if that changes.

- **No clamp tightening for third-person**: Left the existing `[-π/2, π/2]` clamp in place. At extreme pitches the camera orbits to directly above/below the avatar, which is usable. Can tighten to `[-π/3, π/3]` if clipping is reported.

## Test Coverage
- 5 new tests in `useKeyboardControls.test.ts`: pitch survives `computeMovement`, constant orbit radius, world direction matches camera→avatar vector, behind-vs-front hemisphere, yaw regression.
- 8 new tests in `useShooting.test.ts`: front-view direction + origin, behind-view + first-person regressions, `getWorldDirection` call-vs-no-call assertions.
- Full suite: 244/244 pass.
