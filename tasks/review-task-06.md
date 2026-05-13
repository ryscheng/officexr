# Task 6 Review — Room editor multi-select + groups

## Summary
Almost there but **does not ship** — `pnpm --filter @officexr/studio typecheck` fails on the new test file, and `groupCommands` has a real React-updater contract bug (latent, no current caller relies on the return value, but the function lies about its contract). Selection model, group cascade, storage migration, and inspector multi-select branch are all solid. Two factual claims in the prompt are wrong (typecheck is NOT clean; the `SceneStorage` alias retirement listed in the plan was NOT done).

## Spec Compliance

| # | Requirement | Status | Notes |
|---|---|---|---|
| 1 | `selection` promoted to `Set<string>` everywhere | ✅ | `useRoomDocument.ts:66,118`; `SceneEditorCanvas.tsx:20,231`; `CommandHistory.tsx:6`; `RoomApp.tsx:94,106` all on `ReadonlySet<string>` |
| 2 | `groups: Record<string, RoomGroup>` in-memory doc | ✅ | `commands.ts:110`; `emptyRoomDocument` initialises to `{}` |
| 3 | `groupCommands` / `ungroupCommands` / `groupOf` / `deleteSelection` mutators wired | ⚠️ | All four present (`useRoomDocument.ts:443,454,481,153`). `groupCommands` return value is broken — see Critical |
| 4 | `commandToGroup` + `groupMembers` memoized indexes | ✅ | `useRoomDocument.ts:130-155`, keyed on `[doc.groups, compiled]` |
| 5 | `useRoomInspector` multi-select branch | ✅ | `useRoomInspector.ts:136-148` — "delete all" + "group" buttons, both wired to real mutators |
| 6 | Click semantics: plain replaces, Ctrl/Cmd toggles, group selects whole group | ✅ | `SceneEditorCanvas.tsx:336,350`; `RoomApp.tsx:48-54`; `useRoomDocument.ts:240-271`. Note: logic is duplicated, not delegated to the pure helpers — see Important |
| 7 | Storage switched to `FilesystemRoomStorage` / `LocalStorageRoomStorage` | ✅ | `useRoomDocument.ts:100-106`; localStorage key bumped to `officexr:studio:lastRoom` |
| 8 | Tests: selection toggling, group create/delete/ungroup, deleteSelection atomicity, save/load round-trip | ⚠️ | Only the pure helpers are tested (16 cases in `room-selection.test.ts`); the hook itself is untested. Save/load round-trip with groups lives at `world/src/scenes/room-map-storage.test.ts`. The hook's group-cascade and deleteSelection atomicity have NO direct test |
| 9 | Retire deprecated `SceneStorage` alias from Task 2 | ❌ | `SceneStorage`, `FilesystemSceneStorage`, `LocalStorageSceneStorage` are still exported from `packages/world/src/scenes/index.ts:2,79-80`. The prompt claims they were retired; they were not. No live consumers in studio/realtime-server/sdk/core-refactor, so the export is dead code, but the plan explicitly listed retirement under Task 6 |

**Compliance Score**: 6/9 fully met, 2 partial, 1 missed.

## Issues Found

### Critical (must fix before commit)
- **`packages/studio/src/modes/room/room-selection.test.ts:29`**: TS2339 — `Property 'sort' does not exist on type 'readonly string[]'`. `atomicSelectionFor` returns `readonly string[]`, and `.sort()` is `Array<T>`-only. `pnpm --filter @officexr/studio typecheck` exits 2. The prompt's "studio + world typecheck clean" claim is false. Vitest passes because esbuild strips types, but `pnpm typecheck` (which is what `pnpm build` and CI run) breaks. Fix: wrap the result, e.g. `[...atomicSelectionFor('cmd-2', lookup)].sort()`.

- **`packages/studio/src/modes/room/useRoomDocument.ts:458-477`**: `groupCommands` has a React-updater contract bug. The function declares it returns the new `groupId` on success (`string | null`), but the assignment `groupId = id` happens inside the `setDoc((prev) => …)` updater, which React invokes lazily during reconciliation. By the time `return groupId` runs at line 476, the updater has not yet executed, so the caller always sees `null` (in dev StrictMode it would actually see the last of two invocations). Additionally, `mintGroupId()` is called inside the updater — non-idempotent side effect inside a "must-be-pure" callback violates React's contract and will burn an id every StrictMode dev render. No current caller reads the return value (`useRoomInspector.ts:146` ignores it), so this is latent, but the function lies about its contract and the next caller will hit the bug silently. Fix: mint the id and check `inAny` synchronously against `docRef.current` (or split into "validate then mutate"), then call setDoc with a pure updater.

### Important (should fix)
- **`packages/studio/src/modes/room/useRoomDocument.ts:443-450` (`deleteSelection`)**: Calls `setDoc(...)` and a second `setSelectionState(...)` from inside an outer `setSelectionState` updater. React requires updater callbacks to be pure; calling other state setters from within one is a side effect that will execute twice in dev StrictMode. The functional updaters happen to be idempotent for filter operations so the result converges, but the pattern is fragile and the inner `setSelectionState` inside `deleteCommandsInternal` (line 427) is dead work — the outer `return new Set()` (line 448) overwrites whatever it produced. Cleaner: capture the selection via a ref (or take it as an argument), call `setDoc` and `setSelectionState` at the same call-stack level, both as pure updaters.

- **`packages/studio/src/modes/room/useRoomDocument.ts:240-271` vs `packages/studio/src/modes/room/room-selection.ts:38-62`**: The plan calls out `room-selection.ts` as the extracted, testable home of the click-semantic rules, and the hook's own docstring at line 238 says "the pure helpers live in `room-selection.ts` and these wrappers feed them the live lookup." They don't. `pickFromClick` and `toggleFromClick` re-implement the logic inline. The pure helpers are exported and tested but not used in production code — meaning the tests are validating dead code, and a future divergence between the hook and the helpers won't surface in CI. Wire the hook through `selectionFromClick`/`selectionFromToggle` (passing a tiny adapter for the `GroupLookup` shape) so the tests actually cover the live path.

- **`packages/studio/src/modes/room/room-selection.ts:67` (`selectionIsExactlyOneGroup`)**: Same — exported and tested but never imported by any production code in this task. Task 10 will use it for the context menu, so it's OK to land now, but flag it: an unused export with 6 tests is misleading until it's wired up.

- **`packages/world/src/scenes/index.ts:2,79-80`**: `SceneStorage`, `FilesystemSceneStorage`, `LocalStorageSceneStorage` still exported. Plan's Task 6 spec says "Retire the deprecated `SceneStorage` alias from Task 2." Either retire them as planned (no live consumers found in `packages/studio`, `packages/realtime-server`, `packages/sdk`, `packages/core-refactor`), or document in implementation notes why retirement was deferred. Currently a silent plan deviation.

- **`tasks/implementation-notes.md`**: Still missing — flagged in every prior review (01–04). Task 6 made non-obvious calls that warrant explicit notes: (a) why the hook duplicates the helpers' logic rather than delegating, (b) why `SceneStorage` retirement was skipped, (c) the deliberate non-cancellation of in-flight saves on rapid edits (the debounce timer is cleared by the cleanup but a save already in flight will resolve — fine for v1 but worth noting), (d) the `nextGroupSeq` module-level mint counter. CLAUDE.md's "document the reason inline" applies.

### Minor (nice to fix)
- **`packages/studio/src/modes/room/useRoomDocument.ts:108-114`**: Initial state reads `localStorage[LAST_ROOM_KEY]` but `LAST_ROOM_KEY` changed from `'officexr:studio:lastSceneV2'` to `'officexr:studio:lastRoom'`. Existing users who had `lastSceneV2` set will get the default room on first reload after this lands. Not wrong (it's a schema bump) but a one-time silent migration would be friendlier: `localStorage.getItem(LAST_ROOM_KEY) ?? localStorage.getItem('officexr:studio:lastSceneV2') ?? DEFAULT_ROOM_NAME`. Acceptable to skip if you're OK with the reset.

- **`packages/studio/src/modes/room/useRoomDocument.ts:203-208`**: `serializeRoom({...}) as RoomDocument` — the cast is a structural no-op (SerializedRoomV3 and RoomDocument are byte-identical) but the cast hides the fact that one is the *wire form* and the other is the *in-memory form*. If they ever diverge (e.g. adding a `Map<>`-typed in-memory index), the cast will silently break. Cleaner: `RoomStorage.save` takes `SerializedRoomV3` directly, or write a `toRoomDocument(serialized)` round-trip.

- **`packages/studio/src/modes/room/useRoomDocument.ts:172-175,193-196`**: The auto-save dedup hashes only `commands` + `groups`, not `title` or `updatedAt`. A title edit (no current UI for it, but the field exists) wouldn't trigger a save. Fine for v1 since there's no title editor, but worth noting in case a title input lands later and silently doesn't save.

- **`packages/studio/src/modes/room/useRoomInspector.ts:74`**: `as () => Record<string, never>` cast is unusually narrow; `Record<string, never>` is the type of "an empty object". The cast works because Leva's input is structurally compatible, but a less hostile cast (`as () => Record<string, unknown>` to match the actual return) would document intent better.

- **`packages/studio/src/modes/room/SceneEditorCanvas.tsx`**: Filename still `SceneEditorCanvas.tsx` — the plan only specified renaming the document/inspector hooks, but for consistency with "Room editor" naming this is a natural next step. Not in scope; flag only.

- **`packages/studio/src/modes/room/CommandHistory.tsx:2,151`**: Type import is `SceneCommand` (the legacy alias), not `RoomCommand`. The type itself hasn't been renamed in `commands.ts` (it's still called `SceneCommand` even on `RoomDocument`), so this is consistent — but worth a follow-up rename pass once `RoomDocument` is the only consumer.

- **`packages/studio/src/modes/character/CharacterApp.tsx:19,41,54`**: Identifier rename `CharactersApp` → `CharacterApp` (and `CharactersHud` → `CharacterHud`) is in the working tree. This is a **Task 5 leftover** — `StudioPage.tsx:5,69` imports `CharacterApp` so the app was broken at HEAD and only compiles now. Worth flagging because Task 5's review marked compliance complete; the actual fix landed silently in Task 6. Best behaviour: fold this change into the Task 6 commit message ("incidentally fixes the dangling `CharactersApp` export from Task 5") or hoist it into a tiny prep commit.

## What Looks Good
- **Group cascade is correct.** `deleteCommandsInternal` (`useRoomDocument.ts:394-434`) does a single-pass expansion through groups (sound because v1 disallows nesting), drops extrudes whose target was deleted (line 408-409), drops singleton-leftover groups (line 416, `>= 2` is the right threshold), and clears the deleted ids from selection (line 427-431). All four cascade rules from spec criterion 3 are implemented.
- **`groupCommands` v1 invariants enforced.** `< 2 ids → null` (line 457). "Already in a group → no-op via prev return" (line 461-464). No throw. The early-return shape matches the documented contract — only the *return value* is broken (see Critical).
- **`lookup` memo dependencies are minimal and correct.** `[doc.groups, compiled]` (line 155). `instancesByCommand` derives from `compiled.instances` only; `commandToGroup`/`groupMembers` derive from `doc.groups` only. Fresh refs on each mutation so `===` child memoization works.
- **Compile widening is safe.** `CompileInput = SceneDocument | RoomDocument | { commands }` (`compile.ts:13`) is a clean structural intersection — the algorithm only reads `doc.commands`, so accepting either v2 or v3 needs no behavioural change. Tests (world 100/100) confirm.
- **`pickFromClick`/`toggleFromClick` correctly atomic.** Corrupt-group case (group exists but member list is empty) falls back to the single command (line 248, line 257) — same defensive shape the pure helper uses.
- **`groupMembers` returned as `readonly string[]`** — the hook hands out a reference to `g.commandIds` directly (line 146). Callers can't mutate the doc via the lookup. Good.
- **Storage migration path through `migrateToV3`** is centralised in both `FilesystemRoomStorage.load` (`filesystem-room-storage.ts:53`) and `LocalStorageRoomStorage.load` (`localstorage-room-storage.ts:80`). Legacy v2 inputs gain `groups: {}` cleanly.
- **SOLID/DIP:** No new `import * as THREE` outside renderer (`SceneEditorCanvas.tsx:2` is pre-existing). `grep -rn "from 'three'" packages/sdk packages/realtime-server packages/core-refactor` returns zero. SDK/world boundary respected.

## Test Coverage

| Area | Tests Exist | Coverage Notes |
|---|---|---|
| Pure selection helpers | Yes (16) | `room-selection.test.ts` covers `atomicSelectionFor`, `selectionFromClick`, `selectionFromToggle`, `selectionIsExactlyOneGroup` including corrupt-group, partial-group, and set-order-independence cases |
| Hook `pickFromClick`/`toggleFromClick` | No | Logic duplicates the helpers; if the duplication drifts, tests pass while production breaks. Wire the hook through the helpers OR mock-render the hook |
| Hook `groupCommands` / `ungroupCommands` | No | Including the v1 "already in group" rejection — completely untested |
| Hook `deleteSelection` cascade | No | The four cascade rules (group expansion, extrude drop, singleton drop, selection clear) have no direct hook test |
| Save/load with groups | Indirect | `packages/world/src/scenes/room-map-storage.test.ts` tests the storage layer round-trips groups. The hook's save-debounce + dedup path is untested |
| Storage migration v2→v3 | Yes | `packages/world/src/scenes/rooms-maps.test.ts` covers `migrateToV3` |

**Test Coverage Assessment**: 16 new tests cover the *pure* helpers thoroughly, but as noted in Important #2, those helpers aren't on the production code path. The hook's load-bearing logic (group cascade, deleteSelection atomicity, autosave debounce) is uncovered. The prompt's claim "the hook itself (group cascade, deleteSelection, autosave debounce) is NOT directly tested because the studio vitest env is node-only — confirm that's reasonable given the pure helpers cover the load-bearing logic" is **not quite right** — the helpers DON'T cover the load-bearing logic because the hook duplicates them. Either (a) refactor the hook to use the helpers, then accept the indirection, or (b) add a `renderHook`-style test using `@testing-library/react` (which works in node + jsdom and is already a transitive dep of vitest's react integration if you enable `environment: 'jsdom'` for that test file).

## Test Execution

| Check | Result | Details |
|---|---|---|
| Test command discovered | Yes (`vitest run`) | From `packages/studio/package.json` scripts |
| Test suite run | Passed (27/27) | studio: 3 files, 27 tests, 2.16s. world: 10 files, 100 tests, 5.66s |
| Typecheck (`pnpm typecheck`) | **Failed** | `src/modes/room/room-selection.test.ts(29,48): error TS2339: Property 'sort' does not exist on type 'readonly string[]'` |
| Vite build | Passed | esbuild doesn't typecheck — the build artifact is OK, but CI that runs `tsc --noEmit` will reject this commit |
| TDD evidence in implementation notes | N/A | No `tasks/implementation-notes.md` exists for this task |

**Test Execution Assessment**: vitest is green but the typecheck blocker fails. The prompt's "studio + world typecheck clean" claim was inaccurate; the prompt author likely ran `pnpm build` (which uses esbuild) instead of `pnpm typecheck`.

## Implementation Decision Review

| Task | Decisions Documented | Decisions Sound | Flags |
|---|---|---|---|
| Task 6 | No (no `tasks/implementation-notes.md`) | Mostly | (a) Duplicating helper logic in the hook rather than delegating is **not sound** — it makes the pure-helper tests cosmetic. (b) Skipping `SceneStorage` retirement is undocumented. (c) The `groupCommands` return-via-closure pattern is **not sound** — it lies about its contract. (d) `selectionIsExactlyOneGroup` is dead until Task 10 — landing it now is fine but should be flagged. (e) The migration-friendly localStorage key bump (no fallback read) is a deliberate reset; that's a UX call worth a note. |

**Decision Assessment**: Most of the architecture is right — the cascade rules, the lookup memoization shape, the v1 group invariants, the storage migration. The two soundness flags (helper duplication, groupCommands return bug) are both fixable without restructuring. The pattern of "extract pure helpers, test them, but don't use them" is the kind of decision a one-line implementation-notes entry would have surfaced for review.

## Recommendations
1. **Fix the typecheck error** (`room-selection.test.ts:29`) — one-line fix, blocks every CI run.
2. **Fix `groupCommands` return value** — either mint synchronously and validate against a `useRef<RoomDocument>` of the current doc, or split into a `tryGroup(): {ok: true, id} | {ok: false, reason}` shape. While you're there, move `mintGroupId()` out of the updater.
3. **Wire `pickFromClick`/`toggleFromClick` through `selectionFromClick`/`selectionFromToggle`.** Pass the live `lookup` as the adapter. Either delete the duplicate logic from the hook or delete the (then-redundant) test cases that are not actually exercising production code.
4. **Decide on `SceneStorage` retirement** — either drop the exports (no live consumers) or note the deferral.
5. **Add `tasks/implementation-notes.md`** (overdue from Task 1) capturing the four decisions called out above plus the helper-duplication / groupCommands-return rationale.
6. **Either delete or document `selectionIsExactlyOneGroup`** as "lands now, used by Task 10 context menu."
7. **Smoke test on a Cmd-click loop** — Mac path was not exercised; the code uses `e.metaKey` correctly in both `SceneEditorCanvas.tsx:336` and `CommandHistory.tsx:83`, but manual verification on macOS would close the spec acceptance criterion.
