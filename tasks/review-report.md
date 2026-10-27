# Code Review Report — Character-Movement Scenario Tests (Motion Regression Suite)

## Summary

Strong, careful implementation. The physics changes are honest (no fudge offsets), the bot movement genuinely flows through the new `CharacterMovement` interface, the unit tests call real Rapier and assert specific behaviour, and the deliberate SOLID bends are documented inline per CLAUDE.md. **One requirement is materially short of the PRD's headline deliverable: the human player path (`SceneFrame.tsx`) does NOT delegate to `CharacterMovement` — it remains a full duplicate.** That, plus the corridor spec dropping the velocity-vector fall assertion on a partly-incorrect premise, are the two things to resolve before this can be called "done" against the PRD as written. Neither blocks shipping the *tests*; both are correctness-of-claim gaps against an explicit spec.

---

## PRD Compliance

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| Q1 | Dual-gate fall-respawn rule (`shouldRespawnFalling`, `MAX_FALL_VELOCITY`, `FLOOR_PROBE_RANGE`) in rules.ts; old Y-floor demoted to backstop | ✅ Complete | `rules.ts:75-80` pure fn; backstop retained at both call sites (`SceneFrame.tsx:621`, `BotDriver.tick:392`). TDD tests present. |
| Q3 | CharacterMovement interface — ONE path, human + bot share it | ⚠️ Partial | Interface + `BotCharacterMovement` built and bot side fully migrated. **Human (`SceneFrame`) does NOT use it** — it duplicates gravity, KCC step, progress calc, floor probe, respawn inline. Migration step 3 ("adapt SceneFrame to delegate") not done. See Important #1. |
| Q4 | linear-walk bot mode as pure intent source (`walk(dir)` only, no physics) | ✅ Complete | `linearWalk.ts` is pure; no Rapier/Three; normalizes + unit-tested. |
| Q5 | Two-bot head-on collision spec | ✅ Complete | `scenario-collision.spec.ts` asserts vel vectors approaching + ~0 blocked, position stability, no respawn. |
| Q5 | Stairs investigation (gating) — written finding, climbable decision | ✅ Complete | `STAIRS-INVESTIGATION-FINDING.md` + compound-step collider (Path B). Honest reasoning for why single-AABB and 2 m cubes were rejected. |
| Q6 | Real authoring pipeline: layout → bake GLB → room → map | ✅ Complete | All 3 scenarios have layout/baked GLB/room/map. Task-13 resolves baked-room geometry into worldObjects so the authored content drives colliders (injection removed). |
| Q2 | Video-comparison spike + numeric/keyframe fallback gate | ✅ Complete | `VIDEO-COMPARISON-SPIKE.md` finding + supplementary util; numeric + keyframe PNGs are the committed gate. |
| Q7 | Motion-baseline harness (manifests, helpers, keyframe dirs) | ✅ Complete | `motion-helpers.ts` + manifests. (Manifest content drift — see Minor.) |
| S1 | Corridor: settle, monotonic +Z, **fall vel.y ≤ −MAX_FALL_VELOCITY**, respawn, re-settle | ⚠️ Partial | All present EXCEPT the fall **velocity-vector** assertion was replaced with a position assertion (`pos.z > 15`) on an incorrect "vel.y always 0" premise. See Important #2. |
| S2 | Collision scenario assertions | ✅ Complete | vel.x/vel.z ±0.05 while blocked; Δpos < tol; no fall. |
| S3 | Stairs: monotonic Y, reach top ±0.3, no respawn | ✅ Complete | Monotonic-Y sampling, top reach assertion, explicit no-spurious-respawn assertion. (Tolerance widened to ±0.5 on top reach — see Minor.) |
| GR | DIP greps clean; no THREE/react in headless physics; lint:no-bespoke-renderer; honest physics; e2e run | ✅ Complete | Verified: new physics files import neither three nor react; DIP greps return zero; user-confirmed lint + mugshot/character-on-surface 0% drift. |

**Compliance Score**: 10/12 fully met; 2 partial (the architectural headline Q3, and corridor scenario assertion S1#3).

---

## Issues Found

### Critical (must fix before shipping)
None. No data loss, no security exposure, no crash, no silent corruption. The physics changes are sound.

### Important (should fix)

- **`packages/world/src/renderer/SceneFrame.tsx:259-661` — Human path is not unified with `CharacterMovement`.** This is the PRD's #1 deliverable ("There is ONE code path for character movement — human and bot share it", Q3 + "Migration strategy" step 3). `SceneFrame` still independently integrates gravity (`verticalVelRef.current += GRAVITY * dtSec`, line 438), calls `controller.computeColliderMovement` directly (line 530), computes its own floor probe + dual-gate (lines 609-624), and runs its own respawn. The bot side genuinely delegates; the human side only *adopted the dual-gate rule and intent-verb comments* but is still a parallel implementation. The inline SRP note (lines 248-258) honestly documents the bend and gives a concrete "what would remove this", which is exactly what CLAUDE.md asks for — so this is a *documented* deviation, not a silent one. But the PRD treats SceneFrame delegation as in-scope, not optional, so it should either be implemented or the PRD scope explicitly renegotiated. Concrete divergence risk this creates: see next item — the two paths already compute `progress` differently.

- **`packages/world/src/renderer/SceneFrame.tsx:589-592` — Human path still uses the OLD magnitude-ratio `progress`; bot path was fixed to dot-product (task-11).** `BotPhysicsWorld.step()` (lines 525-529) was deliberately changed from `sqrt(correctedLen/intentLen)` to `dot(corrected,intent)/intentLenSq` precisely because the magnitude ratio reports ~0.42 "progress" when the KCC slides a character *backward* against its intent, causing pass-through instead of blocking. `SceneFrame` still does `correctedLen / intentLen` (the exact bug that was fixed for bots). For a human walking head-on into another character, the player can be classified as "moved" while sliding backward. This is the strongest concrete argument FOR completing the unification: the divergence the PRD warned about ("a bug fix to one path does not fix the other") has already materialised in this very changeset.

- **`tests/playwright/scenario-corridor.spec.ts:288-308` — Fall velocity-vector assertion (PRD S1 #3) dropped on an incorrect premise.** The spec comment says "BotCharacterMovement.broadcastVel always has y=0 … vel.y in the store is always 0 for bots", and substitutes `pos.z > 15`. That premise is only true for the bot's *own* store. The store the test reads (`__OFFICE_STORE__`, the browser/observer) receives the bot's position over the in-memory channel and `PositionBroadcaster.flushPosition` (`packages/sdk/src/realtime/outbound/position-broadcaster.ts:183-189`) **overwrites** the broadcast vel with a position-delta estimate. During the corridor fall the bot's Y drops fast, so the observer store's `vel.y` is strongly negative — observable. The user explicitly required velocity-VECTOR assertions; the manifest's own `keyframe-02` condition is `vel.y <= -4`. Recommend asserting `vel.y < -4` (or similar, matching the manifest) during the fall window, in addition to the position gate. Asserting the exact `<= -8` accumulator value on the rate-capped delta estimate may be flaky, so `-4` is the right magnitude to gate on. As-is, nothing in the corridor spec would catch a regression where the bot walks off but free-fall velocity stops accumulating — only the position/respawn path is gated.

### Minor (nice to fix)

- **`rapier-test.mjs` (repo root) — stray investigation scratch file committed-adjacent (untracked).** It's a standalone Rapier broadphase probe with `console.log`s. Either move it under a `scratch/`/`investigations/` path that's gitignored, or delete it. It is not referenced by any spec.

- **`tests/playwright/motion-baselines/scenario-corridor/manifest.json:5,16` — manifest drifted from the shipped map/spec.** `spawnPoint` is `{x:0,y:2,z:0}` but the authored map (`maps/scenario-corridor.json`) and the spec use `{x:0,y:0,z:0}` (the y=0 honest-settle value, changed during task-10). `keyframe-02.captureCondition` says `vel.y <= -4` which the spec never asserts. The manifest is documentation/threshold source — keep it truthful or the next person tunes against a stale spawn.

- **`tests/playwright/scenario-stairs.spec.ts:109-110` — top-reach tolerance widened to ±0.5 vs PRD's ±0.3.** PRD S3 #2 says "within ±0.3 m of expected." The spec uses `STAIR_TOP_REACH_THRESHOLD = 5.5 - 0.5 = 5.0`. The implementation note justifies 0.15 m of per-step KCC jitter; ±0.5 is defensible for a 16-step climb but exceeds the spec number. Either tighten to ±0.3 if stable, or note the deviation in the PRD. (The assertion is one-sided `> 5.0`, so it gates "reached near the top" but not "didn't overshoot" — acceptable for a climb.)

- **`packages/world/src/bot/BotPhysicsWorld.ts:227 / SceneFrame controller` — autostep is bot-only.** Documented inline as an OCP-additive choice (the human controller is unchanged, lines 219-226). This is fine and honest, but it is a second concrete behavioural divergence between the two movement paths (bots can climb the compound stairs; the human player currently cannot). Worth tracking alongside the unification work so the stairs scenario isn't silently human-unreachable.

---

## What Looks Good

- **Honest physics throughout.** No magic Y offsets. The corridor spawn at `y=0` (body resolves up out of the platform via KCC penetration recovery), the stairs `voxelPos [0,4,0]` move, and the `stepRise 0.5→0.25` change are all geometry-honest fixes with derivations in the notes — exactly what the `honest-physics-over-fudge-offsets` guardrail demands. `CHARACTER_CONTROLLER_SKIN` left near-zero.
- **The dot-product `progress` fix (`BotPhysicsWorld.step():525-529`) is correct** and the inline comment explains both the failure mode (backward slide reads as 42% progress) and why dot-product clamps it to 0. It does NOT regress wall-sliding: a glancing wall contact still yields a positive forward projection (partial progress preserved); only motion that nets *against* intent is zeroed, which is the desired block semantics.
- **The `corrected.y >= 0` velY-reset branch (`step():489`) does NOT suppress legitimate free-fall.** In free fall `verticalVel < 0` ⇒ `corrected.y = verticalVel*dt < 0` ⇒ branch is false ⇒ accumulation proceeds, so the corridor dual-gate still fires. The branch only catches the autostep-lift phase (`corrected.y > 0`) where `computedGrounded()` is transiently false. The implementer flagged this as a risk; on review the risk does not materialise for the free-fall path. (Edge note: it also resets velY on the landing frame when penetration recovery pushes up, which is benign/desirable.)
- **`BotCharacterMovement` is a clean SRP unit** — intent verb → corrected result, with broadcasting/store left to `BotDriver`. The `dtSec`-on-every-verb interface extension is well-justified in the notes (avoids an implicit `setDt` lifecycle ordering footgun).
- **SOLID bends are documented per CLAUDE.md** — the `step()` BODY_GROUPS filter SRP note, the autostep OCP note, the `SceneFrame` SRP note, the `compoundStepCuboids` approximation note all state principle/why/what-would-remove-it.
- **Compound-steps collider threaded through one source of truth** (`MapColliders` browser side + `BotPhysicsWorld.syncCubes` bot side both dispatch on the kind's `colliderShape`), preventing the "player sees stairs, bot sees a wall" divergence. Good OCP via the kind-JSON field rather than a kind-id switch.

---

## Test Coverage

| Area | Tests Exist | Coverage Notes |
|------|-------------|----------------|
| `rules.ts` dual-gate + constants | Yes | `rules.test.ts` — boundary-inclusive (`-8 → true`, `-7.99 → false`), floor-present false, ascending false. Calls real fn, specific values. Strong. |
| `BotCharacterMovement` | Yes | `bot-character-movement.test.ts` — 10 tests against REAL Rapier (no mocks): velY sign+growth, velY reset on land, hasFloorUnderneath true/false within probe range, blocked→idle, run>walk. Meaningful. |
| `linearWalk` strategy | Yes | `linearWalk.test.ts` — exact direction, normalization, zero-vector fallback, onEnter default, unit-length invariant. |
| `compile-map` layout resolution (task-13) | Yes | 6 tests: back-compat without resolver, instances populated, inline precedence, missing-layout warning, rotation applied, corridor fixture matches layout. |
| Corridor scenario | Yes | e2e: settle, +Z progress, far-edge, respawn-teleport, re-settle + 3 committed keyframes. **Gap: no fall velocity-vector assertion** (Important #2). |
| Collision scenario | Yes | e2e: vel.z sign approaching, vel.x/z ±0.05 blocked (genuine — store vel is position-delta estimate, so tunneling would keep it non-zero), Δpos<tol, no respawn. |
| Stairs scenario | Yes | e2e: settle, monotonic-Y sampling, top reach, explicit no-spurious-respawn. |
| `SceneFrame` human path | No new tests | Pre-existing gap; the magnitude-ratio progress bug (Important #2) is untested for the human. |

**Test Coverage Assessment**: Unit tests are genuine specifications against real physics — they would catch regressions, not just pin current output. The one substantive scenario gap is the corridor fall *velocity* gate, which the user explicitly asked for and which is achievable via the observer-store delta estimate.

## Test Execution

| Check | Result | Details |
|-------|--------|---------|
| Test command discovered | Yes (`pnpm --filter @officexr/world test` → vitest) | From package.json scripts. |
| Test suite run | Passed (281/281 world) | Re-ran world package: 25 files, 281 tests, 2.33s. User pre-verified full 903 across all packages, typecheck on 5 packages, DIP greps, lint:no-bespoke-renderer, 3 scenario specs together, mugshot + character-on-surface 0% drift. |
| TDD evidence in implementation notes | Yes | Notes record RED→GREEN per TDD task (rules, character-movement, linearWalk, compile-map) with pass counts; stairs spec records measured y-progression and regression-check pass counts. |

**Test Execution Assessment**: Green. (Note: the bash tooling in this review session hit a full sandbox temp-overlay on `tasks/`, unrelated to the code — test runs were redirected to files and read back; the suite itself is healthy.)

## TDD Compliance

| Task | Tests Written | Tests Adequate | TDD Skipped Reason Valid | Notes |
|------|---------------|---------------|-------------------------|-------|
| 01 rules dual-gate | Yes | Yes | N/A | Boundary cases real, specific. |
| 03 CharacterMovement | Yes | Yes | N/A | Real-Rapier integration, not mocked. Tests 9/10 use ordering (run>walk) instead of exact-speed equality — justified (Rapier progress is non-linear), still catches "wrong tunable used". |
| 04 linear-walk | Yes | Yes | N/A | Exact direction + invariants. |
| 13 compile-map resolution | Yes | Yes | N/A | Back-compat + resolution + precedence covered. |
| 10/11/12 scenario specs | They ARE the tests | Mostly | N/A | Collision/stairs assert vectors+positions. Corridor drops the fall vel-vector (Important #2). |

**TDD Assessment**: Adhered to where the PRD scoped it. No `expect(true).toBe(true)` filler; no snapshot-style hardcoding in unit tests.
**Test Adequacy**: ~all unit tests meaningful and specific. One scenario assertion (corridor fall velocity) loosened to a position check on a partly-incorrect premise.

## Implementation Decision Review

| Task | Decisions Documented | Decisions Sound | Flags |
|------|---------------------|----------------|-------|
| 03 | Yes | Yes | `dtSec` interface extension, velY-from-accumulator, null-guard pattern — all sound. |
| 05/08 | Yes | Yes | compound-steps over single-AABB/2m-cubes; honest geometry reasoning. |
| 11 | Yes | Yes | dot-product progress + `_lastAppliedPos` staleness fix — correct; but the fix was NOT mirrored into SceneFrame (Important #2). |
| 12 | Yes | Mostly | stepRise<charRadius derivation + autostep + `corrected.y>=0` reset are correct. The "broadcastVel.y always 0" framing leaks into the corridor spec as an over-broad claim (Important #2/#3). |
| 10 | Yes | Partially | Injection removal good; the vel.y rationale is the one flawed call. |

**Decision Assessment**: High quality, well-documented, honest. The single recurring blind spot is treating the bot's internal `broadcastVel.y == 0` as if the *observer store* vel.y were also always 0 — it isn't, because the broadcaster re-estimates velocity from position deltas.

---

## Recommendations

1. **Decide Q3 scope explicitly.** Either (a) complete the human-path migration so `SceneFrame` delegates its per-frame step to a `CharacterMovement` implementation (the PRD's intended end state, and the only thing that retires the duplicated/diverging `progress` logic), or (b) if it's being deferred, record that deferral in the PRD/notes so "ONE code path" isn't reported as met. This is the headline deliverable.
2. **Port the dot-product `progress` fix into `SceneFrame.tsx:589-592`** even if full unification is deferred — the human currently carries the exact pass-through bug that was fixed for bots.
3. **Restore a fall velocity-vector assertion in `scenario-corridor.spec.ts`** (e.g. `vel.y < -4` from the observer store during the fall window) to satisfy PRD S1 #3 and the user's explicit velocity-vector requirement.
4. **Fix manifest drift** (`scenario-corridor/manifest.json` spawnPoint y, keyframe-02 condition) and **remove/relocate `rapier-test.mjs`.**
5. **Reconcile the stairs ±0.5 tolerance** with the PRD's ±0.3 (tighten or document).
