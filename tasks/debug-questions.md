# Debug Questions

## Investigation Summary

**Bug:** Walking motion for avatars is broken when viewed from "3rd party view." Reportedly introduced in a recent PR.

### What I found

The walking animation system was introduced in **PR #33 (a9a43c0)** "Add avatar animation support for GLTF models (Walk/Idle)". It was then refactored in **PR #34 (564e421)** to live inside the modular hooks (`usePresence` for remote avatars, `useKeyboardControls` for local).

Key code locations:

- **Local avatar walking trigger:** `packages/core/src/hooks/useKeyboardControls.ts:426-429`
  - Uses the `moved` flag from input — if any WASD/joystick input applied a step this frame, calls `switchAnimation(localAvatarAnimation, 'walk')`.

- **Remote avatar walking trigger:** `packages/core/src/hooks/usePresence.ts:606-613`
  ```
  const animState = avatarAnimationsRef.current.get(uid);
  if (animState) {
    const prev = avatarPrevPositionsRef.current.get(uid);
    const isMoving = prev ? avatar.position.distanceToSquared(prev) > 0.0001 : false;
    switchAnimation(animState, isMoving ? 'walk' : 'idle');
    avatarPrevPositionsRef.current.set(uid, avatar.position.clone());
  }
  ```
  Walking is inferred from the per-frame avatar lerp delta (>= ~0.01 units displacement).

- **Mixer ticking:** `packages/core/src/hooks/usePresence.ts:617-621` — both remote and local mixers are advanced each frame inside `tickPresence`.

- **Animation clip lookup:** `packages/core/src/components/Avatar.tsx:29-57` (`findAnimation`, `switchAnimation`, `normalizeAnimationName`). Clip names are normalized (`mixamo.com|Walk` → `walk`) and matched case-insensitively with substring fallback.

### Recent PRs that *could* have introduced the regression (none look like an obvious smoking gun)

| PR | Touched | Plausible impact on remote walking? |
|---|---|---|
| #34 (Apr 8) | Moved animation code from RoomScene → usePresence/useKeyboardControls | Logic appears byte-equivalent to PR #33; same forEach, same threshold, same prev-position pattern |
| #36 (Apr 9) | usePresence (added 2D markers), useSceneSetup (self-marker visuals), Avatar.tsx (added `create2DMarker`) | Added new lines, did **not** touch the remote walking block at lines 606-613 |
| #38 (Apr 8) | Per-room avatars, `office_skins` storage bucket, `useAvatarCustomization` | Could change which `modelUrl` ends up on remote presence — if the GLTF that loads has clips named differently from "Walk"/"Idle", `findAnimation` returns undefined and no walk plays |
| #39 (Apr 9) | usePresence position broadcast handler — moved `lastBroadcastPositionRef` cache outside the `presenceDataRef.has(userId)` guard | Doesn't change `avatarTargetsRef` flow; but if `presenceDataRef` isn't populated yet, target is never set and the remote loop never runs for that user (pre-existing behavior, not new) |
| #41 (Apr 16) | New `useShooting` hook, raycasts against avatar meshes | No mutation of avatar group `position` / `rotation` / animation state — should be inert for walking |
| #42 (Apr 16) | `useRealtimeChannel`: `broadcast.ack: false → true`; exponential reconnect backoff | With `ack:true`, position broadcasts now wait for server ack before resolving the send promise. This *could* throttle the effective position-update rate, making remote motion appear sub-threshold (each frame moves < 0.01 units) and causing the remote avatar to be flagged idle even while the source is walking. **This is the most plausible regression candidate I found.** Local walking is unaffected (uses input flag, not broadcast roundtrip). |
| #43 (Apr 16) | usePresence: added `prevJitsiRoomRef` reset of `nearbyUserIdsRef` | Only touches proximity set; no animation effect |
| #44 (Apr 16) | RoomScene refactor of `channelSend`, ConnectionStatusBanner, useChannelLogger | None touch animation state |

### What I verified

- All 222 vitest tests pass (`pnpm test`). There is no test for remote-avatar walking specifically — only local-avatar walking (`useKeyboardControls.test.ts:496-519`).
- The `switchAnimation`, `findAnimation`, `normalizeAnimationName`, and remote-walking detection logic in `usePresence.ts` are unchanged byte-for-byte from PR #33.
- `mixer.update(delta)` is correctly called once per frame for every animation (line 618).
- No code path resets `avatarPrevPositionsRef` mid-frame; cleanup paths only delete entries on user leave / customization change / cleanup.
- The app cannot be probed with Playwright (not installed in the sandbox per `.claude/app-context.md`).

### My leading hypothesis

PR #42's `broadcast.ack: true` change is the most plausible culprit. Position broadcasts at 60ms throttle now wait for server acknowledgment before the next can fire from the same call (the JS doesn't await, but the WebSocket server may serialize them). When the source user is walking, the receiver gets fewer position updates per second; each lerp step moves the avatar by ~8% of a much smaller per-tick delta, so `distanceToSquared(prev)` falls below the `0.0001` threshold and the animation flips to `idle` between updates. From the receiver's POV the avatar is *visually* moving (because of the long lerp), but the per-frame delta is too small to register as motion.

Three alternative hypotheses also remain possible:
- **PR #38 GLTF skin issue:** room skins now come from `office_skins.model_url` (storage bucket `room-skins`). If the uploaded GLB doesn't contain animation clips named anything matching `walk`/`idle`, `findAnimation` returns undefined and the avatar holds bind pose. Local walking would be affected too in this case — but only when *that specific user* is using a GLTF without walk clips.
- **Unrelated rendering regression:** PR #36 added a grid helper, 2D markers, and lerp-based camera following — perhaps something subtly affects the scene traversal or render order for remote avatars in third-person view.
- **GLTF model URL:** the avatar without a `modelUrl` (procedural / Mario / Toad / etc.) has no `AnimationMixer` at all — `onAnimationsReady?.(null)` is called and `avatarAnimationsRef` is never populated. So if "broken" really means "default geometric avatars never walked," that's by design, not a regression.

## Questions

### Q1: What does "broken" actually look like?
**Context:** "Walking motion broken" could mean (a) the avatar slides without a walk cycle, (b) the walk cycle plays but jitters/stutters, (c) the walk cycle never starts (always idle/T-pose), (d) the avatar plays walk indefinitely and never returns to idle, or (e) something else.
**Question:** Which best describes what you see when watching another user (or your own avatar in third-person mode) walk?
**Options:**
- A) Avatar glides/slides across the floor in T-pose or bind pose (no animation at all)
- B) Avatar flickers between walk and idle rapidly while moving
- C) Walk cycle plays but is desynchronized from actual movement (e.g., walks in place while sliding, or walk plays after the movement has stopped)
- D) Walk cycle starts but plays for only one frame then snaps back to idle
- E) Other (please describe)

### Q2: Local vs. remote vs. both?
**Context:** "3rd party view" is ambiguous. The code has two relevant code paths: local-avatar walking (driven by the `moved` keyboard/joystick flag in `useKeyboardControls`) and remote-avatar walking (driven by per-frame position-delta detection in `usePresence`).
**Question:** Where does the bug appear?
**Options:**
- A) Only when watching **other users'** avatars (remote). My own avatar in third-person mode walks fine.
- B) Only when watching my **own** avatar in third-person camera mode (press `C`). Other users' avatars look fine to me.
- C) Both — my own avatar in third-person and other users' avatars are both broken.
- D) Other (please describe)

### Q3: Avatar type — GLTF model or procedural?
**Context:** Walking animations only exist for GLTF models (uploaded `.glb`/`.gltf` skins, including the room-skins library). Procedural avatars (Mario, Luigi, Toad, Peach, Bowser, Wario, default geometric) have no `AnimationMixer` at all and have never had walk animations — that's by design.
**Question:** When the bug manifests, what type of avatar is the *remote* user using?
**Options:**
- A) A custom uploaded GLTF skin (one I or another room member uploaded via Settings → Room Characters)
- B) A built-in procedural character (Mario / Toad / Peach / etc.)
- C) The default geometric avatar (cylinder + sphere)
- D) I don't know — could you check whether walking ever worked for any avatar type, and if so which?

### Q4: Which PR introduced the regression?
**Context:** I identified eight PRs merged in the last ~10 days that touched files near the animation code. None of them obviously broke the remote walking logic; all 222 tests pass.
**Question:** Do you have a way to bisect, or any additional context?
**Options:**
- A) The bug appeared after a specific PR — please name it (or roughly when you first noticed)
- B) I can `git checkout` an older commit and re-test if you tell me which range to bisect — please go ahead and do so
- C) I noticed it after PR #42 (the `ack:true` change) was merged
- D) I noticed it after PR #38 (per-room avatars / room skins) was merged
- E) I'm not sure when it started

### Q5: Any console errors or warnings when the avatar walks?
**Context:** A failing GLTF load, a missing animation clip, or a Three.js mixer warning would surface in the browser DevTools console. I cannot run Playwright in this environment to capture them.
**Question:** When you reproduce the bug with DevTools open, do you see any errors/warnings? Especially:
- "Could not find animation"
- "GLTFLoader" errors
- "AnimationClip" warnings
- Network 404s on `.glb`/`.gltf` URLs
- Any uncaught exceptions
