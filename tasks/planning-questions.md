# Planning Questions

## Codebase Summary

**Existing physics + respawn infrastructure (already works):**
- `packages/world/src/physics/rules.ts` — `respawnThreshold(worldObjects)` returns the Y below which a character "fell off", computed as `(lowest cube bottom) - RESPAWN_MARGIN (10 m)`. This is a Y-floor check, NOT a velocity-threshold check.
- `SceneFrame.tsx` (local player) and `BotDriver.ts` (bots) BOTH call `respawnThreshold` every frame and teleport to `pickRespawnPosition(spawnList)` when `newPos.y < threshold`. Fall-respawn is fully implemented and working for both local and bot characters. No velocity gate exists — any character whose body root drops 10 m below the lowest cube surface is respawned.

**Character-vs-character collision:**
- Bot `BotPhysicsWorld` creates kinematic mirror bodies for every peer and runs the Rapier character controller against them. The controller resolves contact and returns a `progress` fraction. When `progress < minProgress` (configurable `movementBlockThreshold`, default ~0.1), horizontal motion is clamped to zero in `BotDriver.tick()`. So bots ARE stopped by other bots/players. `SceneFrame.tsx` also resolves the local player's body against peer mirrors (both the bot's body and remote player bodies). Character-vs-character collision-blocking is implemented.

**Bot mode system:**
- `BotMode` union: `idle | walk-to-local | walk-away | wander | patrol | orbit`. Each mode is a strategy with `computeIntent(ctx) → {x, z} | null`.
- No "walk along fixed axis" mode exists. The closest is `patrol` (loops four corners of the map) and `wander` (random walk). A new `linear-walk` or `scripted` mode would need to be added to walk the Z axis and fall off, or an existing mode must be composed differently.

**Test seeding + hermetic mode:**
- `window.__OFFICEXR_TEST_SEED__` + `?test=1` in `App.tsx` boots with in-memory storages and a bundled catalog. Seeds are set via `page.addInitScript`. However, the hermetic mode currently only supports editor modes (`map`, `room`, `object`, `character`, `debug`). The debug mode (`#debug`) boots `DebugApp`, which owns the full physics stack and bots.
- The long_corridor map exists as `packages/world/maps/long_corridor.json` — a 2-wide × 8-long corridor of 2 m cubes, spawn point at near-(0,0,0). The map is already in the file system and loadable via the Debug map picker.

**Mugshot approach (for reference):**
- Mugshot uses `canvas.toDataURL()` to grab frames. For static scenes, Playwright's `toHaveScreenshot()` works well.
- Playwright config: `video: 'retain-on-failure'` — video is only recorded when tests fail, not as a primary artifact. There is no existing "record video, commit as ideal, compare later" pipeline.

**Stairs object exists:** `prototype_primitive_stairs` is a registered world object kind in `world-object-kinds.json` and has a thumbnail. Whether its collider correctly allows a character to walk up it (step detection via the character controller's `enableSnapToGround` and the controller's built-in step handling) is untested.

**What does NOT exist yet:**
1. A "walk along fixed axis and fall" bot mode (needed for scenario 1).
2. A "scripted/deterministic path" mode — all current modes are reactive or random.
3. A video-capture pipeline for Playwright (videos are only failure artifacts, never primary baseline artifacts).
4. A "motion scenario" test file format analogous to `mugshot-baselines/`.
5. The PRD's "velocity threshold triggers respawn" is NOT how it works — it's a Y-floor check, not velocity-based. This needs a decision.
6. A stairs map seeded with the staircase object (scenario 3) doesn't exist as a saved map file.

---

## Questions

### Q1: Respawn trigger — is Y-floor sufficient, or do you really need velocity threshold?
**Context:** The PRD says "any character that falls off a ledge that has no surface underneath and reaches some velocity, should then be respawned." The EXISTING implementation already triggers respawn differently: when a character's body root falls below `(lowest cube bottom - 10 m)`, they're teleported to the spawn point. No velocity gate exists. Changing it to a velocity-threshold check would require new physics state (tracking downward velocity against a threshold) and would change the respawn timing — the character would respawn while still falling fast, not after a fixed Y drop.
**Question:** Is the existing Y-floor respawn rule acceptable for this test (i.e., the character walks off, falls 10 m past the platform's underside, and then respawns)? Or does the PRD literally require a velocity-based trigger to be implemented as a new physics rule?
**Options:**
- A) Y-floor check is fine — the test just needs to observe the character walk off and eventually return to the spawn point. No new physics rule needed.
- B) Implement the velocity-threshold rule as a new addition to `rules.ts` and `SceneFrame` / `BotDriver`. This changes real gameplay behavior, not just test wiring.

### Q2: Video comparison strategy — what does "regression check" mean for video?
**Context:** Videos are not deterministic frame-for-frame — GPU rasterization, animation timing, and browser rendering vary across runs, so pixel-diffing two MP4/WebM files is not viable the way PNG diffs work for mugshots. The current Playwright config records video only on test failure. There is no "commit an ideal video, compare future runs" pipeline in this repo. Playwright does support `page.video()` to save a WebM at the end of each test.
**Question:** Given that frame-exact video comparison is not feasible, what does "ideal vs. actual" mean for these video tests? Pick the approach that matches your intent:
**Options:**
- A) **Numeric assertions only:** The test drives a bot through the scenario and asserts observable state (position milestones, respawn detected, collision blocked) via `__OFFICE_STORE__`. No video artifacts committed; the "regression" is that the state machine works. Video is recorded as a Playwright failure artifact for human review when something breaks. This matches how `debug-character-grounded.spec.ts` works.
- B) **Keyframe screenshots:** At specific moments (character near edge, mid-fall, back at spawn; two characters colliding; character at top of stairs) capture a PNG snapshot and pixel-diff against a committed ideal PNG — same pattern as `character-on-surface.spec.ts`. No full video, but visual checkpoints.
- C) **Record video + commit:** Record a WebM for each scenario, commit it alongside the spec, and assert only that a video of non-zero length was produced (no frame diff). The video exists for human review but is not a diff target. Ideal videos would need to be re-recorded whenever the scenario changes.
- D) **Some combination:** e.g., numeric assertions as the regression gate, plus keyframe screenshots at 2-3 moments as optional visual artifacts (not committed as baselines, written to `test-results/` for human review after each run).

### Q3: Bot driving strategy — scripted path vs. new mode?
**Context:** Scenarios 1 and 2 require bots that walk in specific directions (along the Z axis, toward each other). Current bot modes are reactive (`walk-to-local`, `wander`) or geometric (`patrol` loops corners). None walk a fixed axis deterministically. For the "walk down the corridor and fall off" scenario, the bot needs to walk in a fixed +Z direction until it falls, then respawn.
**Question:** How should the bot be directed?
**Options:**
- A) **New bot mode `linear-walk`:** Add `{ x, z }` direction to `BotMode` or a new mode strategy that accepts a fixed direction vector and walks it indefinitely. Plug into the strategy table per OCP. The test creates a bot with `mode: 'linear-walk'` seeded with `direction: {x:0, z:1}`.
- B) **Repurpose `walk-to-local`:** Place the local player at a point far along +Z (or off-world), making the bot walk toward them. Works without a new mode but couples bot behavior to player position placement.
- C) **Direct store mutation from Playwright:** The test injects velocity/position each frame via `__OFFICE_STORE__.setState(...)` to simulate a bot walking, bypassing the BotDriver entirely. Simpler to wire but doesn't test the real physics path.
- D) **Expose a new window hook `__OFFICE_BOTS__.setIntent(botId, {x,z})`** that overrides the strategy's intent each frame — tests drive the bot externally without adding a new mode. Less coupling than option A but still uses real physics.

### Q4: Two-character scenario (test 2) — local player or two bots?
**Context:** Test 2 requires two characters to walk into each other and be blocked. The existing collision system blocks bots against other bots AND bots against the local player (via kinematic mirrors in each bot's Rapier world). Two bots walking toward each other: bot A's Rapier world has a mirror of bot B, and vice versa. However, the blocking behavior depends on both bots' independently simulated physics resolving consistently — there's no single source of truth for a bot-vs-bot collision.
**Question:** For test 2, which pairing do you want?
**Options:**
- A) **Two bots walking toward each other.** Each bot's private Rapier world blocks the other via peer mirrors. Both should stop (progress < threshold). The test asserts both bots' positions stabilize in the store.
- B) **One bot + the local player.** The bot walks toward the local player (use `walk-to-local` mode). The local player is held stationary (gravity settles them, no WASD input in the test). The test asserts the bot's position stops advancing and the local player stays put.
- C) **Either — just document which you choose.** The test is illustrative; the implementation detail doesn't matter for the regression contract.

### Q5: Stairs scenario (test 3) — does the staircase object actually work with the character controller?
**Context:** `prototype_primitive_stairs` exists in `world-object-kinds.json` and has a thumbnail, but there are no tests or maps that exercise a character walking up stairs. The character controller uses `enableSnapToGround(0.3)` which should handle small steps, but a full staircase GLB with its actual collider geometry has never been tested against the kinematic controller in this repo. The collider in `MapColliders` is a single cuboid AABB per placed object — if `prototype_primitive_stairs` has a bounding box that covers the full staircase volume as a solid block, the character can't climb it (it's an opaque box). If the staircase GLB has trimesh or convex hull colliders, the cuboid-based `MapColliders` won't capture step geometry at all.
**Question:** Before building the stairs test, should we investigate whether `prototype_primitive_stairs` actually produces climbable step geometry in Rapier? Or should the stairs test use a constructed ramp built from cubes at ascending Y positions (e.g., 3 cubes at y=0, y=1, y=2 each offset one cube in Z) as a stepping stone?
**Options:**
- A) **Investigate stairs first** — if the existing object's collider doesn't support climbing, the scenario needs new physics work and that's a gating finding.
- B) **Use ascending cubes as "stairs"** — build the stairs map in the test by placing colored_block_blue at ascending voxel positions. This guarantees the character controller can step up (snap-to-ground handles ≤0.3 m steps, and 0.5 m VOXEL_SIZE cubes are within the controller's step detection range). The scenario tests step-climbing even if it doesn't use the actual `prototype_primitive_stairs` kind.
- C) **Use `prototype_primitive_stairs` but scope the test to numeric-only** — assert the character's Y increases as they move in X/Z, without committing visual baselines. Failure mode if the collider is wrong: character Y doesn't increase (they walk into a wall or fall through). No prior investigation needed.

### Q6: Seeding approach — new test map files or runtime store injection?
**Context:** The existing hermetic test mode (`?test=1`) seeds editor documents (maps, rooms, layouts) from `window.__OFFICEXR_TEST_SEED__`. However, these scenarios need live physics, bots, and the full debug stack — they run against `#debug`, not an editor mode. The Debug app loads maps via `useMapPicker`, which reads from the file system API (`/api/maps`, `/api/rooms`, `/api/layouts`). The test server is the real Vite dev server (not hermetic). For test-specific maps, the approach is either: (a) commit new JSON files under `packages/world/maps/` and `packages/world/layouts/`, or (b) inject `worldObjects` directly into the store from the test via `__OFFICE_STORE__.setState(...)` as `debug-character-grounded.spec.ts` does.
**Question:** How should the test scenarios be seeded?
**Options:**
- A) **Commit new map/layout JSON files** (e.g., `scenario-walk-corridor.json`, `scenario-collision.json`, `scenario-stairs.json`) alongside the existing ones. Tests navigate to `#debug` and use the Map Picker to load them (or drive it via a window hook). This is the "production-data" approach — maps are real authored maps, loadable by humans too.
- B) **Runtime store injection** — the test injects `worldObjects` directly via `__OFFICE_STORE__.setState(...)` as `debug-character-grounded.spec.ts` does, and teleports bots/player to desired positions. No new JSON files. More hermetic, less realistic.
- C) **Mix:** Commit simple map JSONs for complex scenarios (corridor, stairs) where geometry matters, but inject simple platforms (4×4 flat) directly for the collision test.

### Q7: Do you want TDD mode for this build?
**Context:** TDD mode means the task implementer writes failing tests before implementation code for each task. For this PRD, most tasks ARE the tests themselves — the deliverable is Playwright specs. There may be a small amount of supporting physics/bot-mode code (e.g., a new linear-walk bot mode, or a new bot pool window hook). TDD for those supporting pieces would mean: write a unit test for the new bot mode strategy first, confirm it fails, then implement.
**Question:** Do you want TDD mode for this build?
**Options:**
- A) Yes — for any new supporting code (new bot mode, new window hook, new physics helper), write unit tests first before implementation.
- B) No — the Playwright specs themselves are the tests; implement supporting code directly and let the specs serve as the integration tests.
