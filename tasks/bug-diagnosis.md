# Bug Diagnosis

## Bug Summary
In third-person camera modes (`third-person-behind` and `third-person-front`), vertical mouse movement (pitch) has no effect on the view, and bullets do not fire in the direction the user is aiming. Yaw (horizontal rotation) works as expected. The mouse-move handler correctly accumulates and clamps pitch into `cameraPitchRef.current`, but `computeMovement` unconditionally calls `camera.lookAt(pPos.x, 1.4, pPos.z)` every frame in third-person, which overwrites the camera's rotation with a fixed aim at the avatar's torso. As a side effect, `useShooting.fireBullet` (which derives bullet direction from `camera.getWorldDirection`) inherits this locked aim: in behind view bullets always graze the avatar's midsection with no elevation control, and in front view bullets fire *toward* the player (backward relative to avatar facing).

## Root Cause
**Confirmed: `camera.lookAt` overwrites pitch every frame.**

In `packages/core/src/hooks/useKeyboardControls.ts` at lines 431–456, the third-person branch of `computeMovement` places the camera at a fixed-height orbit around the avatar and then calls `camera.lookAt(pPos.x, 1.4, pPos.z)` at line 456. `lookAt` builds a full rotation matrix from the camera's current position to the target, discarding whatever pitch the user accumulated via `handleMouseMove` (lines 218–226). Because `computeMovement` runs every animation frame, the pitch is wiped before the next render, so the user never sees a vertical look change.

The camera is placed on a circle of radius `camDist = 3.5` at a fixed `camHeight = 2.2`, and the look-target is fixed at `(pPos.x, 1.4, pPos.z)`. This yields a constant downward aim of roughly `atan((2.2 - 1.4) / 3.5) ≈ 13°` regardless of `cameraPitchRef.current`. This is both the visual pitch bug and the shooting-direction bug: `fireBullet` reads `camera.getWorldDirection` at line 85 of `useShooting.ts`, which returns the vector from camera toward `(pPos.x, 1.4, pPos.z)` — the avatar's torso — not the user's intended aim.

In `third-person-front` the camera is placed in front of the avatar looking back at it, so `camera.getWorldDirection` points *into the player* — so bullets fly backward from the avatar's perspective.

Yaw still works because `computeMovement` (line 434) syncs `playerYawRef.current = cameraYawRef.current` and then derives the orbit position from `yaw`, so mouse-X rotation is preserved through the player ref even though `lookAt` rebuilds the rotation matrix afterward.

## Evidence
- `useKeyboardControls.ts:218–225` — `handleMouseMove` updates `cameraYawRef.current` and `cameraPitchRef.current` and applies `camera.rotation.set(pitch, yaw, 0, 'YXZ')`. Pitch IS being captured.
- `useKeyboardControls.ts:431–456` — third-person branch runs every frame:
  - Lines 444–454 place the camera at fixed `camHeight = 2.2`, on a horizontal circle of radius `camDist = 3.5` around `pPos`. `cameraPitchRef.current` is never read here.
  - Line 456: `camera.lookAt(pPos.x, 1.4, pPos.z)` — unconditionally overwrites `camera.rotation.x/y/z` with a matrix pointing at the avatar's torso. This is the overwrite that kills pitch.
- `useKeyboardControls.ts:143` — when the camera mode toggle re-enters first-person, the author explicitly calls `camera.rotation.set(cameraPitchRef.current, cameraYawRef.current, 0, 'YXZ')` to restore pitch. This confirms the author understood the rotation needed re-applying, but the equivalent third-person path at 431–456 never re-applies pitch.
- `useShooting.ts:84–85` — `camera.getWorldDirection(dir)` is the sole source of bullet direction.
- `useShooting.ts:105` — `new THREE.Raycaster(camera.position.clone(), dir.clone(), 0.5, 100)` raycasts from the camera, so the muzzle is the camera, which is correct for behind-view but wrong for front-view where the camera is behind the user visually.
- `useShooting.ts:130` — `bulletMesh.position.copy(camera.position).addScaledVector(dir, 0.5)` also spawns the bullet at the camera position, so in front-view a bullet appears in front of the player and flies away from the target.
- No test in `__tests__/hooks/useKeyboardControls.test.ts` asserts that pitch survives a `computeMovement` call in third-person; the clamp test at line 381 only checks the ref value and never invokes `computeMovement` afterward.

## Affected Files
- `packages/core/src/hooks/useKeyboardControls.ts` — primary defect. `computeMovement` third-person branch (lines 431–456) ignores `cameraPitchRef` and overwrites rotation via `lookAt`.
- `packages/core/src/hooks/useShooting.ts` — downstream defect. `fireBullet` (lines 79–143) uses `camera.getWorldDirection` unconditionally; this is correct once the camera's rotation is actually honored in behind-view, but it is wrong for `third-person-front`, where bullets must fire along the avatar's facing direction rather than the camera's look direction.
- `packages/core/src/components/RoomScene.tsx:473` — call site for `fireBullet`; will need updating if the `fireBullet` signature changes (see Fix Recommendations §2).

## Fix Recommendations

### Fix 1: Orbit the camera around the avatar using `cameraPitchRef`
File: `packages/core/src/hooks/useKeyboardControls.ts` — replace lines 440–456 (the body after `localAvatar.rotation.y = playerYawRef.current + Math.PI;`).

Replace the fixed-height, pitch-agnostic placement and `lookAt` block with a spherical-orbit calculation that derives the camera position from `(yaw, pitch)` and keeps the look-target centered on the avatar. The avatar's center is `(pPos.x, 1.4, pPos.z)` (torso). The camera sits on a sphere of radius `camDist` around that center, offset in the direction specified by `(yaw, pitch)`. In front-view the camera is on the opposite side of the sphere.

Suggested code (drop-in replacement for lines 440–456):

```ts
const camDist = 3.5;
const yaw = playerYawRef.current;
const pitch = cameraPitchRef.current;
// Avatar center that the camera orbits around (torso height)
const centerY = 1.4;
// Sign flips the orbit to the front-view hemisphere
const side = cameraModeRef.current === 'third-person-behind' ? 1 : -1;

// Spherical orbit around (pPos.x, centerY, pPos.z):
//  - yaw rotates in the horizontal plane
//  - pitch tilts vertically (positive pitch raises the camera)
//  - cos(pitch) shortens the horizontal radius as the camera moves up/down
const cosP = Math.cos(pitch);
const sinP = Math.sin(pitch);
camera.position.set(
  pPos.x + side * Math.sin(yaw) * camDist * cosP,
  centerY + sinP * camDist,
  pPos.z + side * Math.cos(yaw) * camDist * cosP,
);
// Always look at the avatar's center — this is a true orbit, so pitch is preserved
// because it's encoded in the camera's position relative to the target.
camera.lookAt(pPos.x, centerY, pPos.z);
```

Notes:
- This is a *true* orbit: `lookAt` is safe here because the pitch is encoded geometrically in `camera.position` rather than being stored only in `camera.rotation.x`. Each frame, the camera is repositioned from `(yaw, pitch)` and `lookAt` produces the correct rotation matching that position.
- The existing `camHeight = 2.2` constant is deleted; height is now derived from pitch (`centerY + sin(pitch) * camDist`). At `pitch = 0` the camera sits at `y = 1.4`, eye-level with the avatar, which is flatter than the old `2.2`. If the product prefers the old default baseline you can add a small baseline offset, e.g. `const centerY = 1.4; const baselinePitch = 0.23; const effectivePitch = pitch + baselinePitch;` — but the cleaner option is to just let pitch start at 0 at eye-level and let the user aim up/down freely. Use the existing clamp `[-π/2, π/2]` applied in `handleMouseMove` line 223.
- Do NOT also set `camera.rotation` manually afterward — `lookAt` already does it correctly from this new position.

### Fix 2: Handle `third-person-front` in `fireBullet`
File: `packages/core/src/hooks/useShooting.ts` — update `fireBullet` signature and direction calculation.

With Fix 1 applied, behind-view works automatically: the camera's world direction now correctly reflects the user's pitch because the camera is truly orbiting the avatar, and `getWorldDirection` returns the vector from the orbiting camera to the avatar — which aligns with the crosshair.

Front-view still needs special handling: in that mode the camera looks back at the player, so `camera.getWorldDirection` points *into* the avatar. We need to fire along the avatar's forward vector instead. The avatar's forward direction (from `playerYawRef`) is `(-sin(yaw), 0, -cos(yaw))`.

Change the `fireBullet` signature to accept the current camera mode and player yaw, and branch on it:

```ts
// useShooting.ts — update the exported type and implementation

export type CameraMode = 'first-person' | 'third-person-behind' | 'third-person-front';

export interface ShootingHandle {
  fireBullet: (
    camera: THREE.PerspectiveCamera,
    scene: THREE.Scene,
    avatars: Map<string, THREE.Group>,
    cameraMode: CameraMode,
    playerYaw: number,
    playerPosition: THREE.Vector3,   // avatar position in third-person
  ) => void;
  updateBullets: /* unchanged */;
}

// Inside fireBullet, replace the direction + origin setup (lines 84-85 and 105, 130):

const dir = new THREE.Vector3();
let origin: THREE.Vector3;

if (cameraMode === 'third-person-front') {
  // Fire along the avatar's facing direction, from the avatar's torso — NOT the camera.
  dir.set(-Math.sin(playerYaw), 0, -Math.cos(playerYaw));
  // Small upward aim from the avatar so bullets leave from chest height.
  origin = new THREE.Vector3(playerPosition.x, 1.4, playerPosition.z);
} else {
  // first-person and third-person-behind: camera's world direction is correct
  camera.getWorldDirection(dir);
  origin = camera.position.clone();
}

const rc = new THREE.Raycaster(origin.clone(), dir.clone(), 0.5, 100);
// ... (rest of raycast logic unchanged) ...

// Bullet spawn position:
bulletMesh.position.copy(origin).addScaledVector(dir, 0.5);
```

And update the call site in `RoomScene.tsx:473`:

```ts
const handleShootMouseDown = (event: MouseEvent) => {
  if (event.button !== 0) return;
  if (is2DModeRef.current) return;
  if (document.pointerLockElement !== renderer.domElement) return;
  fireBullet(
    camera,
    scene,
    avatarsRef.current,
    cameraModeRef.current,
    playerYawRef.current,
    playerPositionRef.current,
  );
};
```

Notes:
- `third-person-front` shooting uses a horizontal-only forward vector (`y = 0`). This matches the decision in the user answers ("shoot in the avatar's facing direction, ignore camera direction"). If pitch should also apply in front-view, the caller can pass `cameraPitchRef.current` and the direction becomes `(-sin(yaw)*cos(pitch), sin(pitch), -cos(yaw)*cos(pitch))` — but the user's answers explicitly say front-view shoots along avatar facing, so we keep it flat.
- The raycast origin moves from `camera.position` to the avatar's torso in front-view. This is important: if we kept the camera as origin, the first 0.5–3.5 units of the ray would intersect nothing useful (the camera is in front of the avatar facing away from the target), and bullets would spawn behind the firing direction.

## Test Strategy

### Unit tests (add to `packages/core/src/__tests__/hooks/useKeyboardControls.test.ts`)
1. **Pitch survives `computeMovement` in third-person-behind.**
   - Set `cameraModeRef.current = 'third-person-behind'`; set `cameraPitchRef.current = 0.5`; call `computeMovement(...)`; assert that `camera.position.y` is `1.4 + sin(0.5) * 3.5` (≈ 3.08) and the camera's world direction has a non-trivial positive `y` component (looking up).
2. **Pitch survives `computeMovement` in third-person-front.** Same as above with the opposite side sign.
3. **Camera orbits on a constant radius around the avatar.** For several `(yaw, pitch)` combinations, assert `|camera.position - (pPos.x, 1.4, pPos.z)|` is `camDist` (3.5) within floating-point epsilon.
4. **Avatar stays centered in view.** After `computeMovement`, assert `camera.getWorldDirection()` normalized equals the normalized vector from camera to `(pPos.x, 1.4, pPos.z)`.
5. **Yaw still works in third-person.** Sanity regression — preserve the existing yaw behavior.

### Unit tests (add to `packages/core/src/__tests__/hooks/useShooting.test.ts`, create if missing)
6. **Front-view fires along avatar facing.** With `cameraMode = 'third-person-front'` and `playerYaw = 0`, assert the spawned bullet's `direction` equals `(0, 0, -1)` (north in the coordinate system used), not the camera's forward vector.
7. **Front-view spawns bullet at avatar torso.** Assert the bullet's initial position is near `(playerPosition.x, 1.4, playerPosition.z) + 0.5 * direction`.
8. **Behind-view uses camera direction.** With `cameraMode = 'third-person-behind'` and a pitched camera, assert the bullet's direction matches the camera's world direction within epsilon.
9. **First-person unchanged.** Regression test — current behavior preserved.

### Manual smoke test
10. Switch to third-person-behind, move mouse up and down — the camera orbits vertically around the avatar; the avatar stays centered on screen. Fire — bullets travel where the crosshair points (tracers visibly curve up/down with pitch).
11. Switch to third-person-front, move mouse up and down — same orbit, avatar stays centered. Fire — bullets travel along the avatar's facing direction (same direction as when walking forward with W), NOT toward the camera.
12. Switch back to first-person — pitch and yaw still work; shooting still aims with the crosshair (regression check for the rotation-restore path at line 143).

## Risk Assessment

- **Camera-avatar clipping at steep pitches.** At `pitch ≈ ±π/2` the camera is directly above or below the avatar at distance `camDist`. Because `cos(pitch) → 0` the horizontal offset collapses and the camera's look-target is the avatar's head from directly above/below — this is usable but may clip the avatar mesh. Mitigation: clamp pitch tighter for third-person (e.g., `[-π/3, π/3]`) if clipping is noticeable. The clamp site is line 223 in `handleMouseMove`.
- **Default view-angle shift.** The new orbit puts the camera at `y = 1.4` (eye-level with the avatar) at `pitch = 0`, whereas the old camera sat at `y = 2.2` (slight downward look). Testers may notice the view "feels lower" at first. Two remediations:
  - Apply a small baseline pitch offset (e.g., `+0.23 rad`) so the rest position matches the old look angle. This preserves muscle memory at the cost of asymmetric pitch range (less look-up than look-down).
  - Leave as-is and let playtesters adjust — this yields symmetric pitch but changes feel.
- **Shooting semantics in front-view.** The user answer says "shoot in avatar's facing direction, ignore camera". If future product feedback wants pitch to also apply in front-view (e.g., aim up to arc a bullet over cover), the signature is already parameterized — pass `cameraPitch` and rebuild the direction with the pitch component.
- **`getWorldDirection` elsewhere.** Grep for other call sites to ensure none rely on the old behavior. Specifically, check `confetti` spawn (`RoomScene.tsx` around line 460) — if it uses `camera.position` as spawn origin in third-person, the confetti will appear behind the avatar in front-view. Consider the same mode-aware origin fix.
- **Networking / broadcast.** `broadcastRot` at line 467 sends `{x: 0, y: playerYawRef.current, z: 0}` in third-person — pitch is intentionally not broadcast. The fix does not change this, so remote viewers will not see local pitch. That is consistent with existing behavior but worth confirming with product.
- **Test coverage gap.** Existing `useKeyboardControls.test.ts` does not invoke `computeMovement` for pitch; the new tests cover that gap and will guard against future regressions of this exact class of bug (rotation-overwrite-via-lookAt).
