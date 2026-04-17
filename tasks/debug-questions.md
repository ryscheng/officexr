# Debug Questions

## Investigation Summary

**Bug confirmed by code trace.** The hypothesis in the investigation task is correct, and the same root cause also explains the shooting trajectory breakage.

### Root cause (in `packages/core/src/hooks/useKeyboardControls.ts`)

Mouse input correctly updates `cameraPitchRef.current` and `cameraYawRef.current` in `handleMouseMove` (lines 218–226):

```ts
cameraYawRef.current   -= (event.movementX || 0) * 0.002;
cameraPitchRef.current -= (event.movementY || 0) * 0.002;
cameraPitchRef.current = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, cameraPitchRef.current));
camera.rotation.set(cameraPitchRef.current, cameraYawRef.current, 0, 'YXZ');
```

But every frame in `computeMovement`, the third-person branch (lines 432–456) re-positions the camera behind/in-front of the avatar and then calls:

```ts
camera.lookAt(pPos.x, 1.4, pPos.z);   // line 456
```

This recomputes `camera.rotation` to aim at a **fixed height of 1.4 m on the avatar**, regardless of `cameraPitchRef`. Consequences:

1. **Pitch is silently discarded every frame in third-person.** `cameraPitchRef` keeps accumulating from mouse Y movement (and is still clamped to `±π/2`), but `camera.rotation.x` is overwritten by `lookAt` on the very next animation tick. The user sees no pitch change.
2. **Yaw still works** because `computeMovement` syncs `playerYawRef.current = cameraYawRef.current` (line 434) and positions the camera using that yaw, so mouse-X rotation feels correct. This matches the bug report — only pitch is broken.
3. **Shooting trajectory breaks** because `useShooting.fireBullet` (lines 79–143 of `useShooting.ts`) computes bullet direction via `camera.getWorldDirection(dir)` (line 85). In third-person that direction is whatever `lookAt(pPos.x, 1.4, pPos.z)` produced — a fixed aim from the orbiting camera to the avatar's torso, *not* where the user is aiming. So:
   - In **third-person-behind**, bullets always fly forward at a slight downward angle that intersects the avatar's midsection — elevation is locked regardless of user pitch.
   - In **third-person-front**, `getWorldDirection` points *toward the player* (camera looks at the avatar from in front), so bullets fire **backward** relative to where the player is facing.

### Why first-person works

In first-person, `computeMovement` takes the `else if (localAvatar)` branch (lines 457–460) and never calls `lookAt` or writes to `camera.rotation`. The rotation set by `handleMouseMove` persists, so pitch and yaw both work, and `camera.getWorldDirection` returns the actual aim vector.

### Supporting evidence

- Line 143 (camera mode toggle to first-person) explicitly restores `camera.rotation.set(cameraPitchRef.current, cameraYawRef.current, 0, 'YXZ')` — the author knew rotation needs re-applying when re-entering first-person, but the third-person branch never applies pitch at all.
- No existing test in `__tests__/hooks/useKeyboardControls.test.ts` asserts that pitch survives a `computeMovement` call in third-person mode. The only pitch test (`clamps cameraPitch to [-PI/2, PI/2]`, line 381) checks the ref-value clamp but never invokes `computeMovement` afterward.
- `fireBullet` has no camera-mode awareness — it trusts `camera.getWorldDirection` unconditionally.

### Affected files
- `packages/core/src/hooks/useKeyboardControls.ts` (primary — `computeMovement` lines 431–456)
- `packages/core/src/hooks/useShooting.ts` (downstream — `fireBullet` lines 79–143 inherits the broken camera rotation)

---

## Questions

### Q1: Desired pitch behavior in third-person
**Context:** Once pitch is wired into the third-person camera, we need a product decision about what pitching should *do*. Two common approaches:
- **Orbit** — the camera orbits vertically around the avatar (stays at `camDist`, but height and look-target change with pitch). The avatar stays centered on screen.
- **Free-look / aim** — the avatar stays anchored relative to the camera's local axes and the camera pitches freely around its own origin (what first-person does). The avatar may drift off-screen when looking up/down.

**Question:** Which behavior do you want?
- A) Orbit around the avatar (feels like typical 3rd-person action games — WoW, Fortnite)
- B) Free-look — camera pitches around its own origin, avatar anchored in world
- C) Hybrid — orbit, but aim vector for shooting uses the pitch independently of where the camera is looking

### Q2: Shooting direction in third-person
**Context:** Even after pitch is fixed, there's a design question for shooting. Because the camera sits behind/in-front of the avatar, `camera.getWorldDirection` does not pass through the avatar's position — bullets visually spawn from the camera, not the gun/avatar.

**Question:** Where should bullets originate and aim?
- A) From the camera, in the camera's look direction (current behavior — simplest, matches the crosshair if we add one)
- B) From the avatar's position, aimed along the camera's look direction (feels more realistic; requires a small offset from avatar origin)
- C) From the avatar, aimed at where a center-screen raycast hits (classic 3rd-person shooter — camera aims, avatar fires)

### Q3: Is `third-person-front` meant to be aimable at all?
**Context:** In `third-person-front` the camera is in front of the avatar looking back. Even with pitch fixed, firing a bullet "in the camera's look direction" means firing *toward* the player. This mode seems intended for selfie / face-cam viewing rather than gameplay.

**Question:** In `third-person-front`:
- A) Disable shooting entirely
- B) Shoot in the avatar's facing direction (ignore camera direction)
- C) Leave it as-is (bullets fly toward the viewer — probably never the user's intent)

### Q4: Scope of this fix
**Context:** The root cause is in `computeMovement`'s unconditional `camera.lookAt(...)` in third-person. A minimal fix replaces `lookAt` with an explicit rotation computed from `cameraYawRef` + `cameraPitchRef`. A larger refactor could separate "camera transform" from "aim vector" to make shooting independent.

**Question:** Preferred fix scope?
- A) Minimal — keep camera orbiting behind/in-front but honor `cameraPitchRef` in third-person. Leave shooting using `camera.getWorldDirection` (bullets follow the restored aim).
- B) Medium — fix pitch AND change shooting to fire from the avatar position along the camera's aim vector.
- C) Larger — introduce an explicit `aimDirectionRef` that both camera and shooting consume, decoupling the two concerns.

### Q5: Does yaw really feel correct today, or just "less broken" than pitch?
**Context:** I traced yaw as working correctly, but I want to confirm your observation. In third-person, moving the mouse horizontally should rotate both the avatar and the camera around the avatar — is that what you see, or does yaw also feel off in some way (e.g., delayed, inverted in front-view, sticky)?

**Question:** Is yaw fully correct in third-person, or are there subtle issues you haven't reported yet?
