# Updated PRD — Character-Movement Scenario Tests (Motion Regression Suite)

_Generated from planning-questions.md codebase audit + full user answers. Authoritative spec; all task files derive from this._

---

## Feature Overview

A suite of three Playwright-driven character-movement regression scenarios that exercise the physics stack in motion — walking, falling, respawning, colliding, and stair-climbing — with numeric assertions (including velocity vector checks) and 2–3 committed keyframe PNGs per scenario. Analogous to the mugshot suite but for motion, not static appearance.

**What does NOT exist yet and must be built:**

1. A new dual-gate fall-respawn physics rule in `rules.ts` (no floor under character AND downward velocity >= threshold).
2. A **CharacterMovement** intent-command interface — the ONE code path every character (human or bot) moves through each tick. Exposes named verbs (`walk`, `run`, `stop`) that map to speed + animation state; internally handles physics step, gravity, collision resolution, snap-to-ground, and the dual-gate fall-respawn rule.
3. A `linear-walk` bot mode that acts as a pure intent SOURCE: it computes a fixed direction and calls `walk(dir)` on the CharacterMovement interface — no direct physics access.
4. Three scenario asset chains: layout JSON -> baked GLB -> room JSON -> map JSON (corridor, collision platform, stairs).
5. A video-comparison spike (investigation doc + optional utility).
6. A motion-baseline artifact harness (`tests/playwright/motion-baselines/`) with keyframe PNGs and manifests.
7. Three Playwright spec files exercising the three scenarios.

---

## Primary Architectural Deliverable — CharacterMovement Interface

This is the headline requirement. The detailed design is specified in task-03.

### The problem being solved

Today, human player movement (`SceneFrame.tsx`) and bot movement (`BotDriver.ts`) are separate, parallel code paths. Both integrate gravity manually, both do collision resolution via Rapier's `KinematicCharacterController`, and both implement their own respawn check. This means:

- A bug fix or tuning change to one path does not automatically fix the other.
- There is no single seam the test suite can drive to exercise the "real" production movement path.
- Animation state (idle/walk/facing) may diverge between human and bot characters.

### The solution: one controller, two intent sources

Extract all of the following into a single **CharacterMovement** class (or equivalent unit) in `packages/world/src/physics/`:

- Physics step (Rapier `KinematicCharacterController.computeColliderMovement`)
- Gravity integration (`verticalVel += GRAVITY * dtSec`)
- Ground detection (`controller.computedGrounded()`)
- Snap-to-ground (`controller.enableSnapToGround`)
- Floor probe (`hasFloorUnderneath`)
- Dual-gate fall-respawn rule (`shouldRespawnFalling(velY, hasFloorUnderneath)`)
- Animation/velocity state derivation (idle / walk / run / facing yaw)

Expose this through an **intent-command API** with named verbs:

```ts
interface CharacterMovement {
  /** Walk in the given unit XZ direction at walk speed. */
  walk(dir: { x: number; z: number }): CharacterMoveResult;
  /** Run in the given unit XZ direction at run speed. */
  run(dir: { x: number; z: number }): CharacterMoveResult;
  /** No horizontal intent this tick — gravity still applies. */
  stop(): CharacterMoveResult;
  /** Force the character to a new world position; zero vertical velocity. */
  teleport(pos: Vec3): void;
  /** Current world-space position. */
  getPosition(): Vec3;
}
```

The result from each verb carries everything a caller needs to broadcast state and check for respawn:

```ts
interface CharacterMoveResult {
  /** New world-space position after physics resolution. */
  newPos: Vec3;
  /** Velocity to broadcast (for peer animation and extrapolation). */
  broadcastVel: Vec3;
  /** Yaw to broadcast (facing direction). */
  broadcastYaw: number;
  /** True if the character actually moved this tick (not blocked). */
  moved: boolean;
  /** Animation state to use this tick. */
  animState: 'idle' | 'walk' | 'run';
  /** Current vertical velocity (m/s, negative = falling). */
  velY: number;
  /** True if a downward floor probe found ground within FLOOR_PROBE_RANGE. */
  hasFloorUnderneath: boolean;
  /** True if the controller reports ground contact. */
  isGrounded: boolean;
  /** Bump events from this step (for bus emission). */
  bumps: Array<{ otherId: string; normal: { x: number; z: number } }>;
}
```

### Intent sources (controllers of the CharacterMovement interface)

There are exactly two intent sources, and they emit the same verbs:

| Intent source | Where | How |
|---|---|---|
| Human player (WASD/keyboard) | `SceneFrame.tsx` | Translates held key state into `walk(dir)` or `run(dir)` (Shift = run) or `stop()` each frame. |
| Bot mode strategy | `BotDriver.tick()` | Calls `strategy.computeIntent()` → maps result to `walk(dir)` / `run(dir)` / `stop()` on the CharacterMovement instance. |

Neither source touches Rapier directly. Neither source tracks `verticalVel`. Neither source implements its own respawn check.

### Speed mapping

The verb-to-speed mapping uses the **existing** speed system — do not introduce a parallel speed table:

- `walk(dir)` → `tunables.playerSpeed` (existing `resolveCharacterTunables` output)
- `run(dir)` → `tunables.playerSpeed * tunables.runSpeedMultiplier` (existing fields)
- `stop()` → zero horizontal movement; gravity still applied

Bot strategies currently return a unit-vector intent and the driver multiplies by speed. After task-03, bot strategies still return `{x,z} | null`; the driver maps `null` → `stop()` and `{x,z}` → `walk(dir)` (or `run(dir)` for modes that opt in). The linear-walk mode always emits `walk`.

### Animation state

The CharacterMovement result carries `animState: 'idle' | 'walk' | 'run'` derived from the verb and the `moved` flag:

- Verb `walk`, `moved = true` → `'walk'`
- Verb `run`, `moved = true` → `'run'`
- Verb `stop` OR `moved = false` (blocked) → `'idle'`

`broadcastVel` is derived from `animState` and `dir`: zero for idle, `dir * walkSpeed` for walk, `dir * runSpeed` for run. Peers use `broadcastVel` for extrapolation and animation — the same logic that today lives separately in `BotDriver.tick()` and `SceneFrame.tsx`.

### Headless constraint (DIP)

The CharacterMovement implementation lives in `packages/world/src/physics/`. It may import from `@officexr/sdk` types and from `@dimforge/rapier3d-compat` (since physics already does). It MUST NOT import from `three` or `react`. DIP greps must stay clean after this task.

`SceneFrame.tsx` is a renderer component and may continue to use `useRapier()` to obtain the `world` handle — it passes that handle into the CharacterMovement constructor. This is the correct DI pattern: the high-level policy (CharacterMovement) accepts a Rapier world as a dependency, not as a direct import of the `three` renderer.

### Migration strategy — incremental, behavior-preserving

Task-03 is NOT a big-bang rewrite. The commit sequence is:

1. Define `CharacterMovement` interface and `CharacterMoveResult` in `packages/world/src/physics/character-movement.ts`.
2. Implement `BotCharacterMovement` (concrete class wrapping `BotPhysicsWorld`'s existing controller logic, now surfacing `velY` and `hasFloorUnderneath`). Adapt `BotDriver.tick()` to use it.
3. Adapt `SceneFrame.tsx` to delegate its per-frame physics step to the same CharacterMovement interface — either a shared class or a parallel implementation of the same interface that uses the r3f Rapier world.
4. At each step: full test suite must pass.

Document any deliberate SOLID violation inline (principle / why / what would remove it).

---

## User Decisions

### Q1 — Respawn rule: NEW dual-gate physics rule (NOT Y-floor-only)

Reject the existing Y-floor-only check as the primary trigger. The real trigger fires when BOTH hold simultaneously:

- **(a) No floor underneath** — a downward probe/raycast finds no surface within `FLOOR_PROBE_RANGE` (suggested default: 2.0 m) below character feet.
- **(b) Downward velocity >= threshold** — `vel.y <= -MAX_FALL_VELOCITY` (suggested default: 8 m/s; negative sign = falling).

When both hold: respawn at spawn point.

The old Y-floor backstop (`respawnThreshold` / `RESPAWN_MARGIN = 10`) MUST remain as a last-resort safety net — a character should not have to fall 10 m below the lowest cube. The backstop is not removed, only demoted.

**Implementation:**
- `packages/world/src/physics/rules.ts`: add `MAX_FALL_VELOCITY`, `FLOOR_PROBE_RANGE` constants and `shouldRespawnFalling(velY: number, hasFloorUnderneath: boolean): boolean` pure function.
- Wire via the CharacterMovement interface (Q3) so one call site covers all characters.
- TDD: write failing unit tests in `rules.test.ts` before implementing (RED -> GREEN -> REFACTOR).
- Honest physics, no magic offsets (repo guardrail `honest-physics-over-fudge-offsets`).

### Q2 — Video comparison: spike then numeric+keyframe fallback

**Spike task (task-02):** Investigate fuzzy/perceptual video comparison — e.g., ffmpeg frame sampling + per-keyframe SSIM or perceptual hash with tolerance, or a lightweight JS/WASM alternative. Assess viability given: no heavy native deps, no unconditional ffmpeg binary requirement, must work on macOS dev + Linux CI. Produce a written finding.

**Committed fallback (always delivered):** Numeric assertions on position + velocity vectors at key moments + 2–3 keyframe PNGs per scenario committed to `tests/playwright/motion-baselines/<scenario>/ideal/`. The regression gate for every scenario spec is: numeric assertions pass AND keyframe PNGs are within perceptual tolerance of committed ideals (Playwright `toHaveScreenshot` with named snapshot or manual PNG diff).

**Artifact layout:**
```
tests/playwright/motion-baselines/
  scenario-corridor/
    ideal/keyframe-01-on-platform.png
    ideal/keyframe-02-falling.png
    ideal/keyframe-03-respawned.png
    manifest.json
  scenario-collision/
    ideal/keyframe-01-approaching.png
    ideal/keyframe-02-blocked.png
    manifest.json
  scenario-stairs/
    ideal/keyframe-01-base.png
    ideal/keyframe-02-mid-climb.png
    ideal/keyframe-03-top.png
    manifest.json
```

`manifest.json` per scenario: scenario name, geometry description, spawn coordinates, assertion thresholds.

### Q3 — CharacterMovement intent-command interface (ARCHITECTURAL — highest priority)

See the full specification in the "Primary Architectural Deliverable" section above.

**Key invariants:**
- There is ONE code path for character movement — human and bot share it.
- The "controller" (intent source) is entirely separated from the "mover" (CharacterMovement).
- The interface is an intent COMMAND API (`walk`/`run`/`stop`) — not a raw velocity setter.
- `velY` and `hasFloorUnderneath` are surfaced from the interface so the dual-gate respawn check runs inside this one path.
- Animation state (`idle`/`walk`/`run`, facing yaw) is derived from the interface result and applied consistently for all characters.
- Fully headless: lives in `packages/world/src/physics/`, no Three, no React.

### Q4 — Test 2: two bots head-on

Two bots in `linear-walk` mode walking toward each other on a 4x4 platform. Each bot's private Rapier world blocks the other via peer mirrors. The test asserts:
- Both bots' positions stabilize (position delta < tolerance over a polling window).
- Both bots' `vel.x` and `vel.z` drop to ~0 (±0.05 m/s) while blocked.
- Neither bot falls off the platform.

### Q5 — Stairs: investigate first (gating task)

Before building the stairs spec, investigate whether `prototype_primitive_stairs` produces climbable Rapier step geometry. The `MapColliders` component uses a single cuboid AABB per placed object (from `geometry-service.worldAABB`). If the staircase AABB is an opaque bounding-box block, the character cannot climb individual steps.

Deliverable: an explicit written finding in the task output:
- If climbable: use `prototype_primitive_stairs` in the stairs layout.
- If not climbable: either (a) fix the collider scheme to emit per-step cuboids, OR (b) fall back to ascending `colored_block_blue` cubes with the decision documented inline (principle: honest physics, no silent workarounds). Only fall back if the investigation concludes the real kind genuinely cannot be made to work.

### Q6 — Seeding: real authoring pipeline end-to-end (CORRECTED)

Do NOT hand-write map JSON from scratch or inject worldObjects via store. Reproduce exactly what a human author does:

1. **Author layouts** (`packages/world/layouts/scenario-*.json`) — `commands` stream of `placeObject` ops matching the schema of existing `layouts/long_corridor.json`. One layout per scenario geometry. Set `optimizer: "simplify-light"` on each.
2. **Bake each layout** via `pnpm tsx packages/world/scripts/bake-layout.ts <name>`. **Commit the baked GLB** to `packages/world/baked-layouts/scenario-*.glb`.
3. **Wrap in rooms** (`packages/world/rooms/scenario-*.json`) with `layoutName` field (schema matches `rooms/platform.json`).
4. **Compose maps** (`packages/world/maps/scenario-*.json`) with `rooms[]`, `spawnPoints[]`, `environment` (schema matches `maps/long_corridor.json`).

Tests load maps via the Debug app's Map Picker (or a window hook). Maps are real authored content a human can open and inspect.

Scenario-1 spawn: above the cube nearest origin. Scenario-2 spawn: two points at opposite Z ends of the 4x4 platform. Scenario-3 spawn: at base of stairs.

### Q7 — TDD: where feasible

TDD applies to (write failing tests BEFORE implementation):
- `rules.ts` new fall-respawn constants + `shouldRespawnFalling()`.
- CharacterMovement interface and `BotCharacterMovement` implementation.
- `linear-walk` bot mode strategy (`computeIntent` unit test).
- Fuzzy-video comparator utility if built.

TDD does NOT apply to: Playwright scenario specs (they ARE the tests), investigation/spike tasks, asset-baking tasks. State this explicitly in those task files.

---

## Scenario Specifications

### Scenario 1 — Walk-off-and-Respawn Corridor

**Geometry:** `scenario-corridor` — a 2(x) x 1(y) x 8(z) platform of `colored_block_blue`. Voxel positions: x in {0,1}, y=0, z in {0..7}. With cubeSize=2: platform spans world X from -2 to 2, world Z from -2 to 14, top face at world Y=2.

**Spawn:** above cube nearest origin (~{x:0, y:6, z:0}).

**Bot:** one bot in `linear-walk` mode, direction `{x:0, z:1}`. The linear-walk mode calls `walk({x:0, z:1})` through the CharacterMovement interface. Walks +Z, falls off far end, triggers dual-gate respawn rule (surfaced from CharacterMovement result), returns to spawn.

**Assertions (numeric + vector):**
1. After settle: `bot.pos.y ≈ 2.5 ± 0.2` (on platform).
2. During walk: `bot.pos.z` increases monotonically for >= 3 s.
3. Fall: `bot.vel.y <= -MAX_FALL_VELOCITY` detected.
4. Respawn: `bot.pos` returns near spawn within 5 s.
5. Post-respawn settle: `bot.pos.y ≈ 2.5 ± 0.2` again.

**Keyframes:** on-platform walking, mid-fall, post-respawn settled.

### Scenario 2 — Two-Bot Head-On Collision

**Geometry:** `scenario-collision` — flat 4(x) x 4(z) platform of `colored_block_blue`. Voxel positions: x in {0..3}, y=0, z in {0..3}.

**Setup:** bot-A in `linear-walk {x:0, z:1}` starting at near-Z end; bot-B in `linear-walk {x:0, z:-1}` starting at far-Z end. Both bots call `walk(dir)` through the shared CharacterMovement interface.

**Assertions:**
1. Initial: `bot-A.pos.z` increases, `bot-B.pos.z` decreases (converging).
2. Blocked: `|pos.z delta over 1 s| < 0.05` for both (stabilized).
3. Velocity: both `vel.x ≈ 0` and `vel.z ≈ 0` (±0.05) while blocked.
4. Neither bot falls off platform or respawns.

**Keyframes:** approaching, contact, blocked/stable.

### Scenario 3 — Stairs Climb

**Geometry:** `scenario-stairs` — determined by task-05 investigation. Either `prototype_primitive_stairs` or ascending `colored_block_blue` cubes. Includes a flat base platform.

**Bot:** one bot in `linear-walk` mode walking toward the stairs, issuing `walk(dir)` through the shared CharacterMovement interface.

**Assertions:**
1. `bot.pos.y` increases monotonically as bot crosses stairs footprint.
2. Bot reaches top height within ±0.3 m of expected.
3. No respawn fires during the climb.

**Keyframes:** base of stairs, mid-climb, top.

---

## Cross-Cutting Guardrails (from CLAUDE.md)

Every task inherits these as acceptance criteria where applicable:
- SOLID by default; document deliberate violations inline (principle / why / what would remove it).
- No `import * as THREE` outside `packages/*/renderer/**`.
- DIP greps clean: `grep -rn "from 'three'" packages/sdk packages/core-refactor` and `grep -rn "from 'react'" packages/sdk packages/core-refactor` must return zero matches.
- `lint:no-bespoke-renderer` must pass.
- Honest physics, no magic offsets.
- Any renderer/physics change: run `pnpm exec playwright test tests/playwright/mugshot-*` and `tests/playwright/character-on-surface.spec.ts` before marking complete.
- `CHARACTER_CONTROLLER_SKIN` near-zero globally — do not increase to "fix" floating.

---

## What Already Exists (do not re-implement)

| What | Where |
|------|-------|
| `respawnThreshold(worldObjects)` Y-floor backstop | `packages/world/src/physics/rules.ts` |
| `pickRespawnPosition(spawns)`, `GRAVITY`, `CHARACTER_CONTROLLER_SKIN`, `SPAWN_DROP_HEIGHT` | same file |
| `worldObjectsToCuboids`, `CuboidDescriptor`, `InstanceAABBLookup` | same file |
| `BotDriver` + tick loop + fall-respawn check | `packages/world/src/bot/BotDriver.ts` |
| `BotPhysicsWorld.step()` — takes `{x, z, dtSec}`, returns `StepResult { corrected, progress, bumps, grounded }` | `packages/world/src/bot/BotPhysicsWorld.ts` |
| `BotPhysicsWorld.teleport()`, `syncCubes()`, `syncPeers()`, `stepWorld()` | same |
| `BotPhysicsWorld.verticalVel` — private field, integrates GRAVITY per tick, resets on grounded | same |
| `BotPool` + `__OFFICE_BOTS__` window hook | `packages/world/src/bot/BotPool.ts` |
| `BotMode` union + `BOT_MODE_STRATEGIES` table (OCP — add entries, never branch on name) | `packages/world/src/bot/modes/` |
| `ModeState` + `BotModeContext` + `BotModeStrategy.computeIntent` → `{x,z} \| null` | `packages/world/src/bot/modes/types.ts` |
| Character-vs-character collision blocking via `progress < movementBlockThreshold` | `BotDriver.tick()` |
| `SceneFrame.tsx` per-frame loop: WASD→dx/dz, `verticalVelRef`, gravity, controller, respawn (Y-floor only today) | `packages/world/src/renderer/SceneFrame.tsx` |
| `long_corridor` layout + room + map | `packages/world/layouts/`, `rooms/`, `maps/` |
| `bake-layout.ts` script + `BAKE_OPTIMIZERS` (ids: `simplify-light`, `simplify-aggressive`, `default`, `none`) | `packages/world/scripts/bake-layout.ts`, `src/app/bake-optimizers.ts` |
| Playwright config + `video: 'retain-on-failure'` | `playwright.config.ts` |
| `debug-character-grounded.spec.ts` — reference pattern for store injection + numeric assertion | `tests/playwright/` |
| `character-on-surface.spec.ts` — reference pattern for keyframe PNG diff | same |
| `waitForCanvasReady` helper | `tests/playwright/helpers.ts` |
| `prototype_primitive_stairs` kind entry | `packages/world/src/world-object-kinds.json` |

---

## Task Ordering and Dependency Graph

```
task-01: Dual-gate fall-respawn rule [TDD]                     — no deps
task-02: Video comparison spike                                  — no deps
task-03: CharacterMovement intent-command interface [TDD]        — depends task-01
task-04: linear-walk bot mode [TDD]                             — depends task-03
task-05: Stairs investigation [gating]                           — no deps
task-06: Scenario corridor assets (layout->bake->room->map)     — no deps
task-07: Scenario collision assets (layout->bake->room->map)    — no deps
task-08: Scenario stairs assets (layout->bake->room->map)       — depends task-05
task-09: Motion-baseline artifact harness                        — no deps
task-10: Scenario 1 Playwright spec                             — depends 01,03,04,06,09
task-11: Scenario 2 Playwright spec                             — depends 01,03,04,07,09
task-12: Scenario 3 Playwright spec                             — depends 01,03,04,05,08,09
```

**Parallel groups at start:** `{01, 02, 05, 06, 07, 09}` — all independent.
**Second wave:** `{03}` after task-01; `{08}` after task-05.
**Third wave:** `{04}` after task-03.
**Final wave:** `{10, 11, 12}` after their respective dependencies.
