# Bug Diagnosis

## Bug Summary
The local user's own avatar displays in T-pose (no animation clip playing — the rig renders in its bind pose and glides across the floor) when the camera is in third-person mode (`C` key). Other users' remote avatars animate correctly. No console errors are emitted. The user reports this appeared after PR #44 (f58439b, "Improve chat reliability and voice status UI").

## Root Cause

**PR #44 is NOT the cause of this bug.** A line-by-line review of commit `f58439b` shows it makes no changes to any code path that touches the local avatar, its `AnimationMixer`, `localAvatarAnimationRef`, `switchAnimation`, `createAvatar`, scene setup, camera mode, or keyboard controls. The PR only touches:

- `packages/core/src/components/RoomScene.tsx` — adds `useChannelLogger` call, adds `jitsiUsers` derived array, adds two props to `ConnectionStatusBanner`, repositions the bottom toolbar from center to left, adds new props to `NetworkDebugPanel`.
- `packages/core/src/components/NetworkDebugPanel.tsx` — full rewrite of the diagnostics panel UI (exports a new `PANEL_HEIGHT` constant).
- `packages/core/src/components/room/ConnectionStatusBanner.tsx` — voice status label changes; adds `micLevel`/`micError` props.
- `packages/core/src/hooks/useChannelLogger.ts` — new hook that registers Supabase broadcast/presence listeners for the debug panel log view.
- `packages/core/src/hooks/useChat.ts` — chat send is now optimistic (appends locally before broadcast).
- `packages/core/src/__tests__/hooks/useChat.test.ts` — test updates.

None of these files is in the local-avatar animation path. `Avatar.tsx`, `useSceneSetup.ts`, `useKeyboardControls.ts`, `useAvatarCustomization.ts`, and `usePresence.ts` are all unchanged in this commit and have not been modified since PR #38 (f58439b~6) at the latest. All 222 vitest tests, including `useKeyboardControls.test.ts` which covers the `switchAnimation` wiring for the local avatar (tests at lines 496–519), pass on HEAD.

### Why the symptoms say the animation ref is `null`

Given the T-pose symptom is isolated to the local avatar — not remote avatars — and remote avatars use the same `createAvatar` → `loadGLTFIntoGroup` → `switchAnimation` code path, we can rule out:
- GLTF clip naming mismatch (`findAnimation` failure) — would break remote too.
- Missing `mixer.update(delta)` — would also break remote; `usePresence.ts:617–621` ticks both.
- `switchAnimation` logic regression — no changes to `Avatar.tsx:41–57` since PR #33.

The remaining viable root cause is that **`localAvatarAnimationRef.current` is `null` at the moment the user enters third-person mode**, so the guard at `useKeyboardControls.ts:427` (`if (localAvatarAnimation) switchAnimation(...)`) silently skips the animation trigger. The avatar renders as a GLTF rig (visible, bind pose = T-pose) but no mixer/action is ever bound or played.

### How `localAvatarAnimationRef` can end up `null` with a GLTF avatar

There are two places that assign `localAvatarAnimationRef.current`:

1. `packages/core/src/hooks/useSceneSetup.ts:246–248` — initial avatar creation on scene mount:
   ```ts
   const localAvatar = createAvatar(scene, localAvatarData, (animState) => {
     localAvatarAnimationRef.current = animState;
   });
   ```
   Uses `avatarCustomizationRef.current` (line 244) as the customization input. At mount time this ref holds the **default** (no `modelUrl`) because `useAvatarCustomization`'s DB query has not yet resolved. Therefore `createAvatar` takes the geometric branch, calls `onAnimationsReady?.(null)` synchronously, and `localAvatarAnimationRef.current` is set to `null` (which is the correct initial state for a geometric avatar).

2. `packages/core/src/hooks/useAvatarCustomization.ts:148–175` — rebuilds the avatar when `avatarCustomization` state changes (DB resolves, user saves settings, etc.). Guarded by `if (localAvatarRef.current && sceneRef.current)`. When both are present, it calls:
   ```ts
   const newLocalAvatar = createAvatar(
     sceneRef.current,
     { ...oldData, customization: avatarCustomization },
     (animState) => { localAvatarAnimationRef.current = animState; },
   );
   ```
   For a GLTF customization (`modelUrl` present), `createAvatar` → `loadGLTFIntoGroup` loads the model **asynchronously** and, on success, calls `onAnimationsReady(animState)` with a populated mixer.

The `null` symptom can arise in these race/guard scenarios — all of which are **pre-existing** (every one of these code paths exists unchanged since PR #38):

**Scenario A — DB-never-returns-a-profile:** If `useAvatarCustomization.ts:67–142` runs a Supabase query that returns no rows for both `office_members` and `profiles` (e.g., a fresh user with no persisted customization), none of the `setAvatarCustomization(...)` calls fires. The state stays at the hard-coded default (no `modelUrl`), so `useEffect [avatarCustomization]` never re-runs with a real `modelUrl`, and the local avatar remains geometric. **This does not match the T-pose symptom** (geometric ≠ T-pose), so rule out.

**Scenario B — Effect ordering at mount:** `useAvatarCustomization`'s `useEffect [avatarCustomization]` fires before `useSceneSetup`'s effect on first render (declaration order in `RoomScene.tsx`: customization at line 135, scene setup at line 388). The guard `localAvatarRef.current && sceneRef.current` (line 154) is false at this first firing, so the rebuild is skipped. When the DB query later resolves and updates `avatarCustomization` state, the effect re-fires — now the guard passes and the rebuild proceeds. `localAvatarAnimationRef.current` is cleared at line 155–158 and re-populated asynchronously after the GLTF load at line 164. **This works in the common case**, but see scenario C.

**Scenario C — Environment query races the customization query:** `RoomScene.tsx:352–368` fires a separate Supabase query for the room's `environment` field and calls `setEnvironment(data.environment)` when it resolves. `setEnvironment` is a dep of `useSceneSetup`'s effect (line 333), so a new scene and new local avatar are constructed — again using `avatarCustomizationRef.current`. If the environment query resolves **after** the customization query, the ref already holds the GLTF modelUrl, and the new avatar is loaded with GLTF; `localAvatarAnimationRef.current` is re-wired via the `useSceneSetup` callback (line 247). That works. **But if the environment query resolves first**, the scene is torn down (clearing the animation ref at `useSceneSetup.ts:311–313`) and rebuilt with the default no-modelUrl customization (geometric avatar, no animation). Then when the customization query resolves, `useAvatarCustomization`'s effect rebuilds with the GLTF — and that works correctly. But during the window between the environment rebuild and the customization effect firing, the avatar is geometric — still not T-pose.

**Scenario D — Save-settings race during scene rebuild:** If the user saves a GLTF customization via the settings panel while the `useSceneSetup` cleanup is in flight (e.g., after changing `environment`), timing is complex. However, this requires specific user interaction and would not match "reliably reproducible on entry → press C."

### The most likely *actual* cause

Given the user's description — **reliably reproducible on entering a room and pressing `C`, no console errors, local-only, no walk cycle ever plays** — the most consistent hypothesis is:

**The local user's `avatarCustomization` has `modelUrl` set, the GLTF loads successfully (no error → no console warning), but the `onAnimationsReady` callback either doesn't fire or fires with `null`.** `loadGLTFIntoGroup` (Avatar.tsx:434–462) takes the animation-ready branch only when `gltf.animations.length > 0`; otherwise it calls `onAnimationsReady?.(null)`. If the uploaded/linked GLB is missing animation clips (e.g., a custom skin uploaded by the user without `Walk`/`Idle` clips baked in), the mixer is never created, `localAvatarAnimationRef.current` stays `null`, and the avatar displays in T-pose because the skinned mesh is rendered with no action driving its bones.

The reason this bug is **local-only, not remote-only** is that the reporter is the user whose own avatar skin is animation-less. Other users in the room likely use different skins (or the built-in procedural avatars, which use `buildAvatarGeometry` and are not skinned meshes at all — hence they can never exhibit T-pose). From the reporter's perspective, "remote avatars are fine" because the remote test subjects don't have the same animation-less GLB.

PR #38 ("Add per-room avatars and custom room character skins") introduced the `office_skins` storage bucket and `avatar_model_url` column, which lets any user upload a custom GLB to their room. If that GLB is exported without `Walk`/`Idle` clips, the bug will reliably reproduce every time the owner enters the room and switches to third-person. Nothing changed in PR #44 that would affect this — the user's bisection claim is incorrect.

## Evidence

- **`git show f58439b --stat`** confirms PR #44 touches only the 6 files listed in the Bug Summary. None is in the avatar/animation path. See absolute paths:
  - `/home/user/officexr/packages/core/src/components/RoomScene.tsx` — diff shows no changes to `useSceneSetup`, `useKeyboardControls`, `computeMovement`, or animation refs.
  - `/home/user/officexr/packages/core/src/components/NetworkDebugPanel.tsx` — UI-only.
  - `/home/user/officexr/packages/core/src/hooks/useChat.ts` — chat send is optimistic.
  - `/home/user/officexr/packages/core/src/hooks/useChannelLogger.ts` — new hook, attaches Realtime listeners only; no Three.js.
  - `/home/user/officexr/packages/core/src/components/room/ConnectionStatusBanner.tsx` — voice status copy.

- **`git log --oneline -- packages/core/src/components/Avatar.tsx`**:
  ```
  87f3f08  (PR #40)   – mobile UI tweaks, unrelated
  1b5a686  (PR #36)   – 2D top-down mode additions
  a9a43c0  (PR #33)   – the one that added Walk/Idle in the first place
  ```
  Avatar animation code has not been modified since PR #36 (`2026-04-01`), well before PR #44.

- **`git log --oneline -- packages/core/src/hooks/useSceneSetup.ts`**: last modified in PR #36.

- **`git log --oneline -- packages/core/src/hooks/useKeyboardControls.ts`**: last modified in PR #37 (docs-only agent framework change; the `computeMovement` / `switchAnimation(localAvatarAnimation, moved ? 'walk' : 'idle')` block at lines 427–429 is unchanged since PR #34).

- **`pnpm test`** — all 222 tests pass. The local-avatar walk-animation wiring is directly covered by `useKeyboardControls.test.ts:496–519`.

- **Symptom specificity:** "T-pose" (skeletal bind pose) requires a skinned GLTF mesh. Geometric (procedural Mario/Toad/default capsule) avatars cannot T-pose — they're plain meshes. So the local user's avatar *is* a GLTF, yet no `AnimationAction` is playing. The only code branch producing this state is `gltf.animations.length === 0` inside `loadGLTFIntoGroup` (Avatar.tsx:453–454), which calls `onAnimationsReady?.(null)`.

- **No console errors:** Consistent with GLTF loading successfully but having no clips. `loadGLTFIntoGroup` never logs when `gltf.animations.length === 0`; it just silently passes `null`. A clip-less GLB produces no warning.

## Affected Files

- `/home/user/officexr/packages/core/src/components/Avatar.tsx` — line **445** is the branch check: `if (gltf.animations.length > 0)`. When false, no mixer is created and the avatar shows in bind pose.
- `/home/user/officexr/packages/core/src/hooks/useKeyboardControls.ts` — line **427–429**: guards `switchAnimation` behind `localAvatarAnimation` being non-null. When null, no animation is played, but the avatar is still rendered and moved around.
- `/home/user/officexr/packages/core/src/hooks/useAvatarCustomization.ts` — line **155–164**: the rebuild path that wires the animation ref when state changes.
- `/home/user/officexr/packages/core/src/hooks/useSceneSetup.ts` — line **246–248**: the initial avatar creation that wires the animation ref on mount.
- `/home/user/officexr/packages/core/src/components/SettingsPanel.tsx` (likely) — where the user selects/uploads the GLB skin. Not yet inspected.
- The GLB file itself in Supabase Storage bucket `office_skins` / `room-skins` (per PR #38) — if this has no `AnimationClip` entries, no bundled change will fix it; the asset must be re-exported with clips.

## Fix Recommendations

**First, diagnose the skin, not the code.** Before changing any source:

1. **Confirm the reporter's avatar `modelUrl`.** Query `office_members` or `profiles` for their current `avatar_model_url`:
   ```sql
   select avatar_model_url from office_members
     where office_id = '<office>' and user_id = '<reporter>';
   ```
2. **Inspect the GLB.** Download the file from the returned URL and open it in `gltf-viewer` (https://gltf-viewer.donmccurdy.com/) or run `npx gltf-pipeline -i skin.glb --stats`. Check whether the `animations` array in the top-level glTF JSON is populated, and whether clip names match the `walk` / `idle` substrings that `findAnimation` (Avatar.tsx:29–39) looks for.
3. **If the GLB has no clips:** the fix is asset-level — re-export the model with `Walk` and `Idle` clips (e.g., retarget Mixamo animations onto the rig). No code change required.
4. **If the GLB has clips but their names don't match `walk` / `idle`:** extend the substring match in `findAnimation` (`Avatar.tsx:29–39`) or `normalizeAnimationName` (`Avatar.tsx:22–27`) to cover the actual clip names. For example, if the Mixamo export is named `mixamo.com|Walking`, the current normalizer strips the `mixamo.com|` prefix but leaves `walking`, which still matches because `findAnimation` uses `key.includes('walk')` at line 36. This should already work — suggesting the problem is more likely clip-absence than clip-naming.

**If the code side also needs hardening** (recommended — fail loud instead of silent T-pose):

5. **Log when a GLB has no animations.** In `Avatar.tsx:434–462`, `loadGLTFIntoGroup`, add a `console.warn` when `gltf.animations.length === 0`:
   ```ts
   if (gltf.animations.length > 0) {
     // …existing branch
   } else {
     console.warn(`[Avatar] GLTF at ${url} has no animation clips — avatar will render in bind pose`);
     onAnimationsReady?.(null);
   }
   ```
   This turns the silent T-pose into an actionable console warning so the next occurrence is diagnosable without source diving.

6. **Log when `findAnimation` returns undefined for `walk`.** In `Avatar.tsx:41–57`, `switchAnimation`, emit a one-time warn when `action` is undefined and `desiredName === 'walk'`. Use a `WeakSet` on the `animState` to avoid spamming.

7. **Do not "fix" the bisection confusion in PR #44.** There is nothing to revert or patch in PR #44's code.

## Test Strategy

- **Asset-level test:** open the reporter's GLB in a GLTF inspector and verify `animations.length > 0`. If zero, replacement asset is the fix.
- **Regression test for missing-clip logging:** add a unit test under `packages/core/src/__tests__/` that mocks `GLTFLoader.load` to yield a `gltf` with `animations: []` and asserts `console.warn` fires once (requires the new log line from recommendation #5).
- **Integration test for local animation wiring (already exists):** `useKeyboardControls.test.ts:496–519` passes an `animState` explicitly and verifies `switchAnimation` is called with `'walk'` / `'idle'`. No regression there.
- **Manual reproduction once fix is in place:** reporter loads the room, presses `C`, walks. Their own avatar should now either (a) play the walk cycle if the asset has clips, or (b) show a console warning pointing at the clip-less GLB if it does not.

## Risk Assessment

- **Risk of editing PR #44 or its sibling commits:** high — nothing in PR #44 relates to this symptom; any changes would be cargo-cult and likely introduce new bugs (e.g., breaking the optimistic chat send or the debug panel).
- **Risk of adding `console.warn` in `loadGLTFIntoGroup`:** very low. It is a diagnostic-only change, no behavior shift. Only noise cost is one warning per clip-less asset load.
- **Risk of replacing the GLB asset:** moderate — if the original GLB is critical to the user's customization (e.g., a specific stylized look), ensure the re-exported version preserves the mesh and materials while adding clips.
- **Regressions to watch:**
  - If someone later uses a procedural (non-GLTF) avatar, the warning path must not fire — confirmed, because `loadGLTFIntoGroup` is only called when `customization.modelUrl` is set (Avatar.tsx:484).
  - If the existing clip-naming heuristic fails on a legitimately named clip, generalizing `findAnimation` too aggressively could cause the wrong clip to play (e.g., a `run` clip matching a `walk` lookup). Keep the current substring match strict.

## Addendum: Recommendation for the reporter

The claim "PR #44 is the culprit" is not supported by the diff. If the reporter wants to confirm regression timing rather than take my word, they can bisect with:

```
git bisect start
git bisect bad HEAD
git bisect good a9a43c0     # PR #33, where animation support was added
```

Each step: run the app, enter a room, press `C`, walk, observe avatar. If the T-pose appears at every commit between `a9a43c0` and HEAD, the bug is an asset-level issue (clip-less GLB), not a code regression at all.
