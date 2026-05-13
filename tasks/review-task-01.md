# Code Review — Task 1: Data schemas + migration script

## Summary

Task 1 lands cleanly. All spec items are present, 46/46 tests pass, typecheck passes, the migrator runs cleanly and produces the expected `rooms/*.json` files. No Critical blockers. A handful of Minor issues are worth tracking but none should block the commit.

## PRD Compliance

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| 1 | `RoomDocument` (v3) + `RoomGroup` in `commands.ts`; `SceneDocument` kept as deprecated alias | Complete | `commands.ts:81-105,98-105`; SceneDocument marked `@deprecated` at `commands.ts:59-63`. |
| 2 | `MapDocumentV1`, `RoomInstance`, `SpawnPoint`, `MapEnvironment` in new `map-document.ts` | Complete | All four types defined; coord-system semantics documented inline (voxel for rooms, world coords for spawns). |
| 3 | `serializeRoom` / `deserializeRoom` (via extended `deserializeScene`) / `migrateToV3` in `serialize.ts` | Complete | v3 case added to `deserializeScene`; `migrateToV3` handles v1/v2/v3 inputs. |
| 4 | `migrateToV3` drops `spawnPoints` and `characterConfigs` from v2 inputs | Complete | `serialize.ts:244-253`; test at `rooms-maps.test.ts:70-83` proves it with `not.toHaveProperty`. |
| 5 | `scripts/migrate-scenes-to-rooms.ts` — reads `scenes/*.json`, writes `rooms/*.json` at v3 | Complete | Script present, runs cleanly, produces `rooms/default.json` + `rooms/default-v2.json`. |
| 6 | Seed `packages/world/maps/default.json` (one `RoomInstance` → `default-v2`, one spawn at `[0,0,0]`, default env) | Complete | `maps/default.json` matches the shape. |
| 7 | Tests: round-trip v3, round-trip MapDocumentV1, migrateToV3 drops right fields, unknown schemaVersion rejected | Complete | 13 new tests in `rooms-maps.test.ts`; unknown-version covered for both Map (`:159`) and Scene (via existing `storage.test.ts:81`). |
| 8 | Script deletes `scenes/` (per plan) | Partial / Deferred | Script intentionally does NOT delete `scenes/`; comment at `migrate-scenes-to-rooms.ts:10-13` explains the existing Vite plugin still serves from `scenes/` until Task 2. Correct call, documented deviation. |

**Compliance Score**: 7/8 fully met; 1 deliberate, documented deferral.

## Issues Found

### Critical (must fix before shipping)
*None.*

### Important (should fix)
*None.*

### Minor (nice to fix)

- **`packages/world/scripts/migrate-scenes-to-rooms.ts:46-76`**: Script uses the parsed `name` field from inside each scene file to construct the output path (`rooms/${room.name}.json`), not the source filename. If a `scenes/foo.json` file happens to contain `name: "bar"` inside, the output goes to `rooms/bar.json`. The existing Vite storage plugin (`vite-plugin-scene-storage.ts:163-164`) defends against this by forcing `name = slug`. Migrator should mirror that defense (or at least warn on mismatch).
- **`packages/world/scripts/migrate-scenes-to-rooms.ts:71`**: `if (room.updatedAt) out.updatedAt = room.updatedAt;` — truthy check fails for `updatedAt === 0`. Use `if (room.updatedAt !== undefined)`. Practically unreachable but technically wrong.
- **`packages/world/scripts/migrate-scenes-to-rooms.ts:31-43`**: The script unconditionally overwrites `rooms/<name>.json` even if it already exists and may be newer than the corresponding `scenes/<name>.json`. The header comment is honest about this, but a `--force` flag or mtime check would prevent a destructive re-run from clobbering hand-edits to a migrated room.
- **`packages/world/src/scenes/commands.ts:81-85`**: `RoomGroup.id` is duplicated as both a Record key in `RoomDocument.groups: Record<string, RoomGroup>` and a field on the value. This invites desync (a caller could write `groups['g-1'] = { id: 'g-2', ... }`). Either drop the field (key is canonical) or document the invariant. Task 6 will surface this either way.
- **`packages/world/src/scenes/map-document.ts:99,113,117`**: `MapEnvironment.ambientIntensity` is not in the plan's environment spec (plan mentions sun/sky/stars/HDRI only). Either the plan should be updated or this field deferred to Task 13 when other env settings land. No implementation-notes.md exists to record this decision; one should be added per CLAUDE.md spirit.
- **`packages/world/src/scenes/rooms-maps.test.ts:58-68`**: `passes v3 docs through unchanged` does not assert `updatedAt` survives the pass-through. The migrator depends on this in `migrate-scenes-to-rooms.ts:71`. Small assertion gap.
- **`packages/world/scripts/migrate-scenes-to-rooms.ts:33,40,74,78`**: All status messages go to `stderr` via `console.error`, including success ones. Conventional split would put success lines on stdout and only real errors on stderr — matters if anyone pipes the output later.
- **`packages/world/src/scenes/serialize.ts:233-265`** (`migrateToV3`): The v3 pass-through and v2 → v3 branches reuse the incoming `commands` array and `groups` object by reference (no defensive copy). This mirrors `migrateToV2`'s existing pattern, so consistent — but worth noting in a `// shares arrays with input` comment so a future caller doesn't mutate-in-place and corrupt the source. Acceptable in v1.
- **`packages/world/src/scenes/serialize.ts:294-316`** (`deserializeMap`): Validates top-level shape only. Nested `RoomInstance.position`, `SpawnPoint.position`, and `MapEnvironment.sun.*` are not validated — a malformed map file with `rooms: [{}]` will deserialize and only fail later at the renderer. Matches the laxity of `deserializeScene` for v2 commands, so consistent, but flagged because the map document is now user-authored and exposed via a forthcoming `/api/maps/*` endpoint.

## What Looks Good

- **SOLID adherence**: `map-document.ts` is data-only; zero `three`/`react`/SDK imports. Grep `grep -rn "from 'three'" packages/world/src/scenes` returns 0 matches. SDK-imports in `serialize.ts` are limited to legacy v1/v2 types (`Vec3`, `WorldMap`, `CharacterConfigs`), which is unavoidable for back-compat. DIP holds.
- **Inline documentation is excellent**. `map-document.ts` documents the voxel-vs-world-coord split (`:23-32`, `:42-44`), the quarter-turn rationale (`:28-31`), and the "null vs disabled" environment encoding (`:91-93`). These match the architectural decisions in the plan verbatim.
- **`migrateToV3` covers all three input versions** in one place, and the v1 branch routes through `migrateToV2` rather than duplicating the cell-grid → placeCube logic. Solid OCP — adding a v4 will not duplicate this branch.
- **Tests are specific.** No `toBeDefined()` filler — assertions use `toEqual`, `toMatchObject`, `not.toHaveProperty`, and regex-matched throw messages. The v1 → v3 test exercises the actual cell-grid → placeCube path.
- **Migration script is conservative**: doesn't delete the source `scenes/` directory, preserves `updatedAt` so re-running doesn't bump mtimes, has a per-file try/catch that skips malformed inputs without aborting the whole run (`migrate-scenes-to-rooms.ts:50-62`). Documented deviation from the plan's "delete `scenes/`" with the reason.
- **Backwards-compat path is intact**. `SceneDocument` is marked `@deprecated` but kept as a real export. `migrateToV2` now handles a v3 input by stripping `groups` — so the existing Scenes editor, which calls `migrateToV2(deserializeScene(raw))` at `useSceneDocument.ts:98`, will not throw if it ever encounters a v3 file. The Vite plugin still serves from `scenes/`, so in practice it won't.
- **Seed map is sensible**: references `default-v2` (which the migrator produces), single spawn at origin, default env with `sky/stars/hdri: null`. Matches the spec exactly.

## Test Coverage

| Area | Tests Exist | Coverage Notes |
|------|-------------|----------------|
| `serializeRoom` round-trip | Yes | `rooms-maps.test.ts:19-34` — full round-trip via JSON, asserts equality. |
| `serializeRoom` defaults | Yes | `:36-42` — empty groups default. |
| `deserializeScene` v3 validation | Yes | `:44-54` — missing groups + missing commands both rejected with regex-matched message. |
| `migrateToV3` v3 pass-through | Yes (gap: `updatedAt`) | `:58-68` — commands + groups asserted; `updatedAt` not. |
| `migrateToV3` v2 → v3 | Yes | `:70-83` — proves `spawnPoints` and `characterConfigs` are *absent* via `not.toHaveProperty`. |
| `migrateToV3` v1 → v3 | Yes | `:85-113` — exercises real cell-grid → placeCube emit. |
| `serializeMap` / `deserializeMap` round-trip | Yes | `:139-144` — full env populated; `:146-157` — null env entries. |
| `deserializeMap` validation | Yes | `:159-171` — unknown version + missing required arrays. |
| `emptyMapDocument` produces valid doc | Yes | `:173-179`. |
| `RoomInstance.rotationY` optional | Yes | `:181-190`. |

**Test Coverage Assessment**: Strong. 13 new tests, all meaningful, all specific. The one gap is `updatedAt` preservation through `migrateToV3` (not in any test), which the migrator script depends on. Low risk because the migrator's own behavior is verifiable via the produced `rooms/default.json` (`updatedAt: 1778544479696` matches `scenes/default.json`).

## Test Execution

| Check | Result | Details |
|-------|--------|---------|
| Test command discovered | Yes (`pnpm --filter @officexr/world test`) | From `packages/world/package.json:18`. |
| Test suite run | Passed (46/46) | 5 files, 329ms tests, no warnings. |
| Typecheck | Passed | `pnpm --filter @officexr/world typecheck` clean. |
| Migrator dry-run | Passed | `pnpm --filter @officexr/world migrate:scenes-to-rooms` produced `rooms/default.json` + `rooms/default-v2.json`. |
| TDD evidence in implementation notes | N/A | No `tasks/implementation-notes.md` file present. |

**Test Execution Assessment**: All checks pass. The migrator is idempotent against its current inputs (re-running produces the same `updatedAt` values).

## Implementation Decision Review

| Task | Decisions Documented | Decisions Sound | Flags |
|------|---------------------|----------------|-------|
| Task 1 | Partially | Mostly | `ambientIntensity` added to `MapEnvironment` without spec/plan coverage; script's choice NOT to delete `scenes/` is correctly documented inline; `RoomGroup.id` duplication with map key is undocumented. |

**Decision Assessment**: The non-obvious calls (don't delete `scenes/`, drop spawnPoints in v2→v3, defer v1→v3 to the v2 path) are all documented inline with the reason. The `ambientIntensity` addition and the `RoomGroup.id`/key duplication aren't called out — those are the kinds of decisions CLAUDE.md says should be either fixed or explained. Adding `tasks/implementation-notes.md` for Task 1 would close this gap before Task 2 starts.

## Recommendations

1. **Ship Task 1 as-is.** No Critical or Important issues.
2. **Before Task 2**: add `tasks/implementation-notes.md` capturing (a) why `ambientIntensity` is on `MapEnvironment` already, (b) the `RoomGroup.id`-vs-key invariant, and (c) the deliberate decision to NOT delete `scenes/` yet (it will get deleted as part of Task 2 when the new `/api/rooms` endpoint takes over).
3. **In Task 2**: harden `deserializeMap` to validate nested shapes (`RoomInstance.position` is a `[number, number, number]`, `MapEnvironment.sun` is fully populated) since the map document will now be exposed via a writable HTTP endpoint.
4. **In Task 2**: when `vite-plugin-storage.ts` replaces `vite-plugin-scene-storage.ts`, port the slug-vs-name-mismatch defense (`vite-plugin-scene-storage.ts:163`) to the migration script as well, or have the migrator emit a warning.
5. **Trivial cleanup** (can be folded into Task 2): switch the migrator's success messages from `console.error` to `console.log`, and replace `if (room.updatedAt)` with `if (room.updatedAt !== undefined)`.
