# Code Review Report — `claude/complete-core-refactor-9BZB8`

## Summary

The branch implements the Local Debug Office per `tasks/updated-prd.md` cleanly. All eleven tasks are present, all tests run green (8 in `debug-app`, 19 in `core-refactor`, 82 in `sdk`), typecheck passes, and `packages/core` is genuinely untouched (`git diff 192b2fc..HEAD -- packages/core/` is empty). Architecture matches the PRD: `Channel` stays in the SDK, `VoiceAdapter` stays in `core-refactor`, and audio is owned by the debug app via `LocalVoiceAdapter` callbacks — no DOM leaks into the SDK or adapter. The `BotDriver` is a fully simulated second client (own Store + SyncEngine + InMemoryChannel + SnapshotHandshake) — not a "ghost bot" mutating the local store.

**Compliance score: 11 / 11 PRD sections fully implemented**, with two real concerns: (a) the dedicated `LocalVoiceAdapter` unit test file required by Task 02 was never created, so most of the adapter's behavioral contract is only indirectly exercised through the integration test, and (b) the bundled `elevator-music.mp3` is a synthetically-generated silent file (the implementer notes confirm this) — wiring is correct but there is nothing to hear.

**Recommendation:** Address the missing LocalVoiceAdapter unit tests and replace the silent MP3 before this is treated as a ship-able developer-experience deliverable. None of the issues block a merge for internal use.

---

## PRD Compliance

| # | Requirement | Status | Notes |
|---|---|---|---|
| 1 | `createStack` factory with `mode: 'local' \| 'supabase'` returning `{ channel, voiceAdapter }` | Complete | `packages/core-refactor/src/factory/index.ts`. Discriminated-union config, exhaustive `never` check, `NoopChannel` for supabase mode. |
| 2 | `LocalVoiceAdapter` with state transitions, fake-participant timer, sync `onRoomJoined`/`onRoomLeft` callbacks | Complete | `packages/core-refactor/src/adapters/local-voice-adapter.ts`. Configurable `participantJoinDelay` (default 300, `0` for tests). `fakeParticipantJoined` flag prevents emitting `remote-participant-left` if the join timer hadn't fired yet. |
| 3 | `SupabaseVoiceAdapter` throw-on-call stub | Complete | `packages/core-refactor/src/adapters/supabase-voice-adapter.ts`. `dispose()` is a deliberate no-op so cleanup paths don't throw. |
| 4 | `WorldRenderer` (Three.js, fresh, no old-core import) | Complete | `packages/debug-app/src/renderer/WorldRenderer.ts`. Avatars, ground, lighting, first-person camera, wireframe bubble. Resize handler. Per-mesh dispose on cleanup. |
| 5 | `packages/debug-app` package scaffold | Complete | `package.json`, `vite.config.ts` (port 5174), `index.html`, `main.tsx`, `App.tsx`, `tsconfig.json`. Picked up by `packages/*` workspace glob. |
| 6 | `DebugOfficePage` composing the full stack | Complete | `packages/debug-app/src/DebugOfficePage.tsx`. Hub → store/bus/actions → rules → sync/handshake → Communication → BotDriver → renderer → RAF loop. Includes WASD + arrow keys. |
| 7 | `BotDriver` — fully simulated second client | Complete | Own Store + Bus + Actions + InMemoryChannel + SyncEngine + SnapshotHandshake. Modes `idle` / `walk-to-local` / `walk-away`. `walk-away` clamps to 20 m from origin. |
| 8 | Bot Control UI overlay | Complete | `packages/debug-app/src/bot/BotControlPanel.tsx`. Three buttons + active-mode highlight. |
| 9 | Bundled audio + LocalVoiceAdapter callback wiring | Partially complete | Wiring in `DebugOfficePage.tsx` is correct (`audio.play()` on `onRoomJoined`, `audio.pause()` + `currentTime = 0` on `onRoomLeft`). The MP3 file is a **synthetically-generated silent** track (see implementer notes for Task 09); ID3v2 + valid MPEG frames, but decoded as silence. Functionally tests trigger behaviour; users will hear nothing. |
| 10 | Headless integration test | Complete | `packages/debug-app/src/__tests__/local-stack-integration.test.ts`. Two scenarios: bot-into-proximity asserts both `communication.getCurrentRoom()` and `localVoiceAdapter.getCurrentRoom()` non-null; bot-walks-away asserts both null again. |
| 11 | Dev README | Complete | `packages/debug-app/README.md` covers start command, demonstrates list, bot/movement controls, test commands, and an explicit "core unaffected" architecture note. |

---

## Critical (must-fix before merge)

_None._ No security holes, data corruption, broken state machines, or failing tests.

---

## Important (should-fix)

### 1. Missing dedicated `LocalVoiceAdapter` unit test file

**Files:** expected at `packages/core-refactor/src/adapters/local-voice-adapter.test.ts` — does not exist.

Task 02 explicitly enumerates 9 named tests and a TDD process culminating in that file. The factory test (`factory/index.test.ts`) only checks method-shape (`typeof voiceAdapter.joinRoom === 'function'`) — it does not exercise:

- Initial state (`getConnectionState() === 'idle'`).
- `connection-state-change` event ordering (`'joining'` then `'connected'`).
- Synchronous-vs-deferred ordering of `onRoomJoined` (the core audio-coupling guarantee).
- `remote-participant-joined` payload shape.
- `remote-participant-left` payload + state reset on `leaveRoom()`.
- Idempotent `joinRoom` for the same room (no second timer scheduled).
- `dispose()` cancels a pending `setTimeout`.
- `fakeParticipantJoined` flag preventing a spurious `remote-participant-left` when leaving before the join timer fired.

The integration test indirectly verifies that `joinRoom` and `leaveRoom` end-state work, but a regression in event ordering or in the `dispose()` cancellation path would slip through. Task 02 was declared TDD; the implementer notes claim "tests passed GREEN" but the file referenced by the test specification is absent. Add the test file with the 9 enumerated cases.

### 2. Audio asset is silent

**File:** `packages/debug-app/public/elevator-music.mp3` (41 KB, ID3v2.3 + MPEG1 Layer III 128 kbps stereo, but with zero-padded audio frames).

Confirmed in `tasks/implementation-notes.md` (Task 09): "Generated the MP3 synthetically using Python (no `ffmpeg` available). … plays as silence rather than actual music." The wiring is correct and verifiable, but the developer-experience promise of the README ("elevator music starts when you enter the bot's proximity bubble and stops when you leave") is not met. Replace with a real royalty-free loop ≤100 KB before treating this as the canonical debug app.

### 3. `Communication` join is fire-and-forget; integration test relies on microtask flushes

**File:** `packages/core-refactor/src/communication/communication.ts:99` — `await this.voice.joinRoom(target, …)` runs inside `recompute()` which is launched via `void this.recompute()` from each bus subscriber. This is consistent with how the rest of the SDK schedules side-effects, but the integration test (`local-stack-integration.test.ts:149`, `:170`) sprinkles `await new Promise(r => setTimeout(r, 0))` to flush the resulting microtasks.

This works in practice for the local adapter (synchronous state transitions; the awaited promise resolves on the same microtask), but if a future `VoiceAdapter` does real async work the test will flake. Consider exposing a `Communication.flush()` test hook or having `recompute` surface a tracked promise. Not a blocker — flag for future test stability work.

### 4. `currentRoom` typing in `LocalVoiceAdapter` allows `null` argument but contract is fuzzy

**File:** `packages/core-refactor/src/adapters/local-voice-adapter.ts:39-43`

`joinRoom(roomId: string | null)` redirects to `leaveRoom()` when `null` is passed. The `VoiceAdapter` interface does declare `roomId: string | null`, so this is contract-compliant — but the implementation doesn't fire the `connection-state-change` for `'joining'` in this path; it just delegates. Communication only ever calls `joinRoom(target)` where `target` may be `null`, so this is exercised on every "leave proximity". The behavior is fine, but neither the inline JSDoc nor any test asserts it. Document it (or add a test) so a future refactor doesn't accidentally start emitting `'joining'` then `'idle'` when leaving.

---

## Minor (nice-to-have)

### 1. Unused import in `BotDriver.ts`

**File:** `packages/debug-app/src/bot/BotDriver.ts:12`

```
import { FakeClock } from '@officexr/sdk/test-harness';
```

`FakeClock` (the value) is never referenced — only the `Clock` type is. Remove the value import. This compiles only because of bundler-erased imports + `isolatedModules`. (`tsc --noEmit` passes because `FakeClock` is exported.)

### 2. Unused `vi` import in `BotDriver.test.ts`

**File:** `packages/debug-app/src/bot/BotDriver.test.ts:1`

`vi` is imported from `vitest` but never used (no spies / fake timers in this file). Drop it.

### 3. `BotControlPanel.activeMode` is local UI state, not driven by `BotDriver`

**File:** `packages/debug-app/src/bot/BotControlPanel.tsx:11`

If anything else ever calls `botDriver.setMode(...)` the highlight goes stale. Today nothing else does, so it's fine — but `BotDriver` could expose a `getMode()` getter and the panel could read from it for source-of-truth. Low priority.

### 4. `BotDriver.tick()` test for `walk-to-local` only asserts distance decreased

**File:** `packages/debug-app/src/bot/BotDriver.test.ts:51-65`

The assertion (`newDist < initialDist`) is correct but very loose; one tick of any non-zero progress would pass. The PRD specifies `1.5 m/s` so 10 × 100 ms ticks should cover ≈1.5 m. Asserting on the rough magnitude (e.g. `newDist <= initialDist - 1.0`) would catch off-by-1000 dt-unit regressions. Optional.

### 5. `DebugOfficePage` first-frame `dt`

**File:** `packages/debug-app/src/DebugOfficePage.tsx:158-162`

`lastTime = performance.now()` is set during `bootstrap()`, which may finish hundreds of ms before the first RAF callback fires, producing a large initial `dt` that is fed straight into `bot.tick(dt)` and the WASD movement integrator. Worst-case effect is a one-frame teleport. Initializing `lastTime` inside the loop on the first invocation (or capping `dt`) would be defensive. Optional.

### 6. `BotDriver.tick()` skips broadcast if `mode === 'idle'`

**File:** `packages/debug-app/src/bot/BotDriver.ts:114`

In idle mode the bot never calls `botSync.flushPosition()`, which means a late-joining peer would only see the bot once the snapshot handshake completes. Today `DebugOfficePage` seeds the bot in the local store directly, so this is invisible. If anything else ever attaches to the hub it'll appear "missing" until the bot first moves. Note for future hardening.

### 7. `DebugOfficePage` async-bootstrap cleanup branch and the main cleanup branch duplicate teardown logic

**File:** `packages/debug-app/src/DebugOfficePage.tsx:124-133` vs `:192-204`

Two near-identical sequences for closing the same set of resources. Easy to drift. Factor into a single `teardownAll()` helper.

### 8. `WorldRenderer.bubbleMesh` is created before any state arrives

**File:** `packages/debug-app/src/renderer/WorldRenderer.ts:49-58`

The bubble sits at world origin until the first `render(state)` call moves it to the local player. Cosmetic; first frame happens within ~16 ms.

---

## What Looks Good

- **Hard architectural boundary preserved.** No file under `packages/sdk/` or `packages/core-refactor/` imports anything DOM-y. The audio coupling is in the debug app, with `LocalVoiceAdapter` only firing typed callbacks. The `Channel`/`VoiceAdapter` split is intact.
- **Old `packages/core` is byte-identical.** Verified with `git diff 192b2fc..HEAD -- packages/core/` (no output).
- **`createStack` discriminated union with `_exhaustive: never` check** is the right shape for adding more modes later (`jaas`, `daily`, etc.).
- **`BotDriver` actually runs a full second client** — own store, own bus, own actions, own channel, own SyncEngine, own SnapshotHandshake — exactly the pattern from `createMultiClientHarness`. The bot's positions reach the local client through the real SyncEngine inbound dispatch path, so the proximity rule fires on real network-shaped events.
- **`participantJoinDelay: 0`** option for `LocalVoiceAdapter` is the right escape hatch for tests; the integration test uses it, avoiding fake-timer plumbing.
- **`fakeParticipantJoined` guard** in `LocalVoiceAdapter` is a thoughtful detail — prevents a spurious `remote-participant-left` event when `leaveRoom` is called before the join-timer fires.
- **`effectAborted` + `cleanup` ref pattern** in `DebugOfficePage` correctly handles React Strict Mode's double-invoke and the case where the user navigates away mid-`bootstrap()`. The async-cleanup early-return branch is well-thought-out.
- **`BotDriver` includes `SnapshotHandshake`**, matching the implementer note and the harness pattern. Late-joining clients can request a snapshot from the bot.
- **Renderer handles dispose properly** — geometries and materials are disposed, canvas removed from container, resize listener detached.
- **Integration test is genuinely end-to-end** for the local stack: it asserts both ingress (room joined) and egress (room left) on the actual `Communication` + `LocalVoiceAdapter` pair, using only the public APIs.
- **README is honest and specific** — explicitly calls out that `@officexr/core` is unaffected, lists keys, lists buttons, gives test commands.

---

## Test Coverage

| Area | Tests Exist | Coverage Notes |
|---|---|---|
| `createStack` factory | Yes (4 tests) | Local/supabase shape + supabase throw verified. |
| `LocalVoiceAdapter` | **No dedicated unit tests** | 9 cases specified in Task 02 are missing. Indirectly exercised via integration test (end-state only). |
| `SupabaseVoiceAdapter` | Partial (1 test in factory) | Only `joinRoom` throw asserted; other methods' throws not asserted. Acceptable since stub is a stand-in. |
| `BotDriver` | Yes (6 tests) | All 6 PRD-specified cases present and meaningful. `walk-to-local` distance check is loose (see Minor #4). |
| `Communication` (pre-existing) | Yes | Unchanged by this branch. |
| `WorldRenderer` | None | Visual; PRD explicitly skips TDD here. |
| `DebugOfficePage` | None directly | Wiring exercised by the integration test (which bootstraps the same components in the same order minus the React/canvas layer). |
| `BotControlPanel` | None | UI only; PRD skips TDD here. |
| Audio wiring | None | Wiring exercised by integration test asserting `getCurrentRoom()` becomes non-null (which is the same callback that fires `audio.play()`). |
| Local-stack integration | Yes (2 tests) | Bot-into-proximity asserts non-null rooms; bot-walks-away asserts null rooms. Solid round-trip. |

**Overall assessment:** Coverage is adequate for the headless side of the wiring, except for the missing dedicated `LocalVoiceAdapter` unit suite which is a real gap (see Important #1).

---

## Test Execution

| Check | Result | Details |
|---|---|---|
| Test command discovered | Yes | `package.json` scripts in each package: `pnpm --filter @officexr/<pkg> test` |
| `@officexr/sdk` test suite | Passed (82/82, 7 skipped pre-existing) | 3.43 s |
| `@officexr/core-refactor` test suite | Passed (19/19) | 0.56 s |
| `@officexr/debug-app` test suite | Passed (8/8) | 0.56 s |
| Typecheck — debug-app | Passed | `tsc --noEmit` |
| Typecheck — core-refactor | Passed | `tsc --noEmit` |
| TDD evidence in implementation notes | Yes (partial) | `execution-metrics.md` reports per-task test counts and statuses; notes for Task 10 explicitly mention "Tests went GREEN immediately". Task 02's claim that "tests passed GREEN" is **inconsistent with the absent `local-voice-adapter.test.ts` file** — the only passing tests covering the adapter are the factory shape-checks and the integration round-trip. |

**Test Execution Assessment:** Everything that exists runs and passes. The concern is what doesn't exist — see Important #1.

---

## TDD Compliance

| Task | Tests Written | Tests Adequate | TDD Skipped Reason Valid | Notes |
|---|---|---|---|---|
| Task 01 (factory) | Yes (`factory/index.test.ts`, 4 tests) | Yes for factory routing | N/A | All 4 specified cases present and pass. |
| Task 02 (LocalVoiceAdapter) | **No (file missing)** | N/A | N/A | Task spec mandates `local-voice-adapter.test.ts` with 9 enumerated cases. None of those 9 exist anywhere. Coverage relies on integration test side-effects. |
| Task 07 (BotDriver) | Yes (`BotDriver.test.ts`, 6 tests) | Yes | N/A | All 6 specified cases present. The `walk-to-local` distance assertion is loose — see Minor #4. |
| Task 10 (integration test) | Yes (`local-stack-integration.test.ts`, 2 tests) | Yes | N/A | Two scenarios cover both ingress and egress of the voice room. Uses `participantJoinDelay: 0` so timing is deterministic. |

**TDD Assessment:** 3 of 4 TDD-declared tasks have meaningful, specific tests. Task 02's required test file is missing, leaving the LocalVoiceAdapter's behavioral contract under-asserted. The implementer notes' claim ("Already implemented + tests passing") is not supported by the file tree.

**Test Adequacy:** ~12 of ~13 expected tests are meaningful and specific. The one weak case is `BotDriver.test.ts` "walk-to-local moves bot closer" (distance-decreased only). The remaining gap is structural (Task 02's missing file), not a quality issue with what was written.

---

## Implementation Decision Review

| Task | Decisions Documented | Decisions Sound | Flags |
|---|---|---|---|
| Task 01 | Yes | Yes | `NoopChannel` inline in factory is fine for the deferred supabase mode. |
| Task 02 | Yes | Mostly | Notes describe the `fakeParticipantJoined` flag accurately. The "Already implemented + tests passing" claim is inconsistent with the missing test file. |
| Task 03 | Yes | Yes | `dispose()` no-op is the correct call so cleanup paths can be unconditional. |
| Task 04 | Yes | Yes | `+0.9` Y offset (half avatar height) and Y-on-XZ camera tracking are sensible for a first-person debug view. Bubble at local player Y matches the XZ-only proximity check. |
| Task 05 | Yes | Yes | tsconfig deviations from the task template (drop `types: ['node']`, add `lib: [DOM]`, `allowImportingTsExtensions`, `isolatedModules`) match `sdk` and `core-refactor` conventions and produce a clean typecheck. |
| Task 06 | Yes | Yes | `effectAborted` + `cleanup` ref pattern correctly handles Strict Mode and the async bootstrap window. The "seed bot in local store immediately" decision papers over a real cold-start window — acceptable for a debug tool. |
| Task 07 | Yes | Yes | Including `SnapshotHandshake` in the bot is the right choice (matches the harness; lets late joiners get state). |
| Task 08 | Yes | Yes | `activeMode` highlight is decorative; trivial scope creep. |
| Task 09 | Yes | **Concerning** | Synthetic silent MP3 is documented honestly, but a debug audio asset that produces no sound undermines the "audio playback triggered by callbacks" demonstrated in the README. The reasoning ("no ffmpeg available") is environmentally valid but the result should be replaced before this is treated as done. |
| Task 10 | Yes | Yes | Inline bootstrap (no harness helper) is appropriate for an integration test that's documenting the wiring. `participantJoinDelay: 0` is the right escape hatch for deterministic timing. |
| Task 11 | Yes | Yes | The "core unaffected" sentence in the README is exactly what the PRD wanted communicated. |

**Decision Assessment:** Implementer reasoning is generally sound and well-documented. Two items deserve correction: (a) Task 02's "tests passing" claim doesn't match the file tree — the dedicated test file is missing; (b) Task 09's silent-audio outcome is environmentally explainable but is a degraded deliverable, not a finished one.

---

## Recommendations (priority order)

1. **Add `packages/core-refactor/src/adapters/local-voice-adapter.test.ts`** with the 9 cases enumerated in `tasks/task-02-local-voice-adapter.md`. This is the only real test-coverage gap.
2. **Replace `packages/debug-app/public/elevator-music.mp3`** with a real royalty-free loop ≤100 KB. The wiring already works; only the asset needs swapping.
3. Drop the unused `FakeClock` import in `BotDriver.ts` and the unused `vi` import in `BotDriver.test.ts` (Minor #1, #2).
4. Tighten the `BotDriver` "walk-to-local" assertion to also bound the magnitude of progress (Minor #4).
5. Optionally factor the `DebugOfficePage` teardown into a single helper (Minor #7) and either expose `Communication.flush()` or surface `recompute`'s promise to remove the `setTimeout(0)` ladder in the integration test (Important #3).
