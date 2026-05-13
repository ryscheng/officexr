# Task 5 Review — Studio Restructure (5-tab shell + dir renames)

## Summary
Ships. Renames are clean (git mv preserves history), `StudioMode` is widened correctly, hash↔state sync is sound, placeholder shells respect the SDK→world DIP boundary, typecheck + 2/2 vitest tests green. One real spec gap (the StudioPage shallow-render test the plan called for is missing) — non-blocking but worth landing before Task 6 starts touching the same component.

## Spec Compliance

| # | Requirement | Status | Notes |
|---|---|---|---|
| 1 | 5 tabs (Map/Room/Object/Character/Debug) in `Header.tsx` | Complete | `Header.tsx:5-15` |
| 2 | StudioPage mounts one of five Apps via `useState<StudioMode>` | Complete | `StudioPage.tsx:29,65-70` |
| 3 | `location.hash` sync + default `#map` | Complete | `StudioPage.tsx:9,29-51,75-79` |
| 4 | `modes/scenes/` → `modes/room/` (git mv) | Complete | All 8 files renamed via git mv; history preserved |
| 5 | `modes/characters/` → `modes/character/` (git mv) | Complete | All 4 files renamed |
| 6 | `ScenesApp.tsx` → `RoomApp.tsx`; export + HUD renamed | Complete | `RoomApp.tsx:21,84`; HUD label "Scene:" → "Room:" at `RoomApp.tsx:104` |
| 7 | `CharactersApp.tsx` → `CharacterApp.tsx`; export + HUD renamed | Complete | `CharacterApp.tsx:19,55`; CharacterApp is byte-identical to old CharactersApp modulo identifier renames — no label/copy drift |
| 8 | Add `modes/map/MapApp.tsx` shell | Complete | Three-pane placeholder with "Coming in Tasks 12-14" banner |
| 9 | Add `modes/object/ObjectApp.tsx` shell | Complete | Reads `listKinds()` and displays per-category counts |
| 10 | Internal hook files (`useSceneDocument`, `useSceneInspector`, `SceneEditorCanvas`) keep their old names | Complete | Imports in `RoomApp.tsx:6-10` still reference `Scene*` filenames per Task 6 deferral |
| 11 | Shallow test: StudioPage mounts the right app per hash + tab change | Missing | No new test file; existing `local-stack-integration.test.ts` does not cover this — see Important |
| 12 | Content of renamed Apps unchanged | Partial | True for `CharacterApp.tsx`. For `RoomApp.tsx`: HUD label flip is **not** the only content edit — see Minor |

**Compliance Score**: 11/12 fully met, 1 missing (test), 1 partial (incidental comment edit).

## Issues Found

### Critical (must fix before commit)
None.

### Important (should fix)
- **`packages/studio/src/` (no file)**: The plan's Task 5 spec explicitly required "a shallow test that StudioPage mounts the right app on each hash + on tab change." None was added. The renames are otherwise sound and the dev server smoke-tested, but Task 6 is going to rename the very hooks that `RoomApp.tsx` imports and a hash-sync regression here would be invisible to typecheck. Recommend adding a `StudioPage.test.tsx` that (a) sets `location.hash = '#room'`, mounts `<StudioPage/>`, asserts `RoomApp` rendered; (b) clicks the Character tab, asserts hash becomes `#character` and `CharacterApp` rendered; (c) sets `#bogus`, asserts fallback to `#map`. Non-blocking for the rename commit itself but should land before Task 6.

### Minor (nice to fix)
- **`packages/studio/src/modes/room/RoomApp.tsx:13-19`**: The docstring was substantively reworded beyond "Scenes → Room" identifier swap — the original ended "via SceneStorage (filesystem in dev)" and now reads "via the room storage in dev"; the parenthetical Task 5/Task 6 migration aside is new. Behaviour-neutral so not a bug, but the prompt said the only content change was the HUD label flip, which isn't quite accurate. Flag for honesty; no action needed.
- **`packages/studio/src/StudioPage.tsx:42,51`**: The hash→mode `useEffect` lists `studioMode` in its dep array, causing the listener to be torn down + re-attached on every mode change. The `fromHash !== studioMode` guard inside the handler reads `studioMode` from closure, so the dep is real, but it could be reduced to `[]` if the handler used a `useRef` for the current mode, or simply dropped the equality guard (React would no-op a `setState` to the same value). Not a bug — just a small wasted subscription churn on every tab click.
- **`packages/studio/src/StudioPage.tsx:34-39`**: Initial mount writes the hash via `replaceState` even when the URL already has no hash and we're defaulting to `#map`. That's the documented intent ("Default landing: `#map`"), so this is by-design — but worth noting that a fresh load of `/studio` will silently rewrite the URL to `/studio#map`. If you ever decide that's user-hostile, the fix is to skip the write when `window.location.hash === ''` and `studioMode === DEFAULT_MODE`. Today's behaviour matches the plan; leaving as-is is fine.

## What Looks Good
- `isStudioMode` (`Header.tsx:17-22`) is a real type guard (`value is StudioMode`), not a `boolean` returning function, so the narrowing flows through `readHashMode()` correctly. `typeof value === 'string'` short-circuit before the `.some` is the right shape.
- `STUDIO_MODES` is the single source of truth — the predicate, the tab render, and the type all derive from one literal table. Open/Closed: adding a 6th mode means appending one entry, no switch to update.
- Mode→hash uses `replaceState` not `pushState` — correct call for tab-switching ergonomics (tab clicks don't pollute browser history; back/forward still works via `hashchange` for users who manually edit the URL).
- All 12 renames went through `git mv`, so history is preserved and the diff against HEAD shows pure renames + the 4 hand-edits.
- DIP boundary respected: `MapApp.tsx` and `ObjectApp.tsx` import from `@officexr/world` (via the scenes barrel for `listKinds`) but never directly from `three` or `@react-three/*`. SDK/realtime-server/core-refactor greps for `'three'`/`'react'` still return zero.
- Lazy state initializer (`StudioPage.tsx:29`) avoids re-reading the hash on every render.
- `MapApp.tsx` and `ObjectApp.tsx` both render the same three-pane skeleton as `RoomApp.tsx` (LeftPanel + main + SidePanel) so the chrome stays consistent across tabs — placeholders feel like real shells, not stubs.

## Test Coverage

| Area | Tests Exist | Coverage Notes |
|---|---|---|
| `StudioPage` hash sync + tab routing | No | The required shallow render test for Task 5 was not written |
| `isStudioMode` predicate | No | Trivial enough that table-driven coverage isn't blocking, but a one-liner would be cheap |
| Renamed apps (`RoomApp`, `CharacterApp`) | Inherited | The two renamed apps are byte-identical (CharacterApp) or near-identical (RoomApp) to the previously shipping Scenes/Characters apps, so existing manual QA carries over. No unit tests existed for the originals either. |
| `MapApp` / `ObjectApp` shells | No | Placeholders only — low value for unit tests, will land with Tasks 11/12-14 |

**Test Coverage Assessment**: 2/2 existing tests pass and typecheck is clean, but the single test the plan asked Task 5 to add is missing. Add before Task 6 changes the import surface.

## Test Execution

| Check | Result | Details |
|---|---|---|
| Test command discovered | Yes (`pnpm --filter @officexr/studio test`) | from `packages/studio/package.json` scripts.test |
| Test suite run | Passed (2/2) | `local-stack-integration.test.ts`, 1.55s |
| Typecheck | Passed | `tsc --noEmit` clean |
| SOLID DIP greps | Passed | `grep -rn "from 'three'\|from 'react'" packages/sdk packages/realtime-server packages/core-refactor` → 0 matches |
| Stale rename refs in studio | None | Only mention of `ScenesApp` in the codebase is the migration comment at `RoomApp.tsx:14` |
| Orphans in old dirs | None | `modes/scenes/` and `modes/characters/` removed (git mv worked) |
| TDD evidence | N/A | Task 5 was not run under TDD mode; the missing test is a plan deliverable, not a TDD-spec violation |

**Test Execution Assessment**: All green. No new test added for the renamed/restructured shell, which is the one real gap.

## Recommendations
1. (Important) Add `packages/studio/src/__tests__/StudioPage.test.tsx` covering: initial hash → mode (valid + invalid + empty), tab click → hash write, `hashchange` event → mode update. Use `jsdom` + `@testing-library/react`; this is a shallow component test, not an integration test. Should be one file, ~50 lines.
2. (Nice-to-have) Drop the `studioMode` dep on the hash→mode `useEffect` in `StudioPage.tsx:51`; either use a ref-mirror of the current mode, or trust React's `setState` bail-out to dedupe.
3. (Nice-to-have) When Task 6 renames `useSceneDocument` / `useSceneInspector` / `SceneEditorCanvas`, update the `RoomApp.tsx:14-18` docstring to drop the "renamed from ScenesApp" parenthetical — it'll be stale once the hook renames land too.
