# Code Review — Three-Layer Architecture Refactor (Final)

Plan: `/Users/raven/.claude/plans/partitioned-launching-moore.md`
Branch: `ravenac95/officexr-studio`
Commits reviewed: `849daec..e41aca2` (14 commits, 9 logical steps + 5 follow-up fixes)

## Summary

This is a clean, deliberate refactor. The three layers — Application
(pure TS, DI), UI (React + context), Rendering (R3F primitives) —
exist as designed, with the geometry service as a single source of
truth for "where does this instance live?" Every renderer / collider
consumer that the plan calls out has been rewired to it. All 161
world tests and 179 studio tests pass; typecheck is clean; both
codebase linters (`lint:no-bespoke-renderer`, `lint:leva-free`) pass;
the CLAUDE.md DIP greps for `three` / `react` imports inside
`packages/sdk packages/realtime-server packages/core-refactor` return
zero matches.

Two real defects remain. One is a correctness bug in the right-click
context-menu picker (`ContextMenuListener`) that the migration
missed — it still treats every instance as a one-voxel cube anchored
at world Y = `pos*vs + vs/2`, so multi-voxel kinds (Cube Prototype
Large A, anything bigger than 0.5 m) are unpickable past their
center voxel and pickable above the floor. The second is that
`moveOccupancy.ts` + `dropToSurface.ts` were on the plan's explicit
rewire list but were not migrated; they still use lower-left-anchored
single-voxel math for existing instances, which diverges from the
canonical centered AABB. The plan called this out and the
implementer deferred — but the verdict in the plan was Step 5/6, and
those steps shipped without doing the work.

**Verdict: fix-first.** Two fixes (an hour each), then ship. The
foundation is sound — the issues are localised to two consumers
that the plan called out for migration and the implementer's own
prior reviews flagged as deferred. Do not let them slip into the
"forever-deferred" bucket; that is exactly the pattern that produced
the divergence the refactor was meant to end.

**Architecture-alignment grade: A−.** Loses points only for the
two unmigrated consumers and one transitive THREE import in the app
layer; otherwise this is the cleanest cross-cutting refactor in the
recent history of this repo.

---

## Plan Compliance

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| 1 | Application Layer in `packages/world/src/app/` — pure TS, no React, no THREE runtime, no module globals | ⚠️ Partial | `types.ts`, `catalog-service.ts`, `geometry-service.ts`, `room-service.ts`, `bake-service.ts`, `scene-service.ts`, `create-default-api.ts`, `index.ts` all present. THREE imports are type-only in `bake-service.ts` (good) BUT it transitively imports `getKindBoundingDimensions` from `../renderer/cube-material.ts`, which does `import * as THREE from 'three'` at runtime. Comment documents the DIP violation per CLAUDE.md guardrails — reviewable, not silent. See Important #3. |
| 2 | UI layer consumes via `useApplication()` + derived hooks | ✅ Complete | `application-context.tsx` exports `ApplicationProvider`, `useApplication`, `useCatalog`, `useCatalogReady`, `useKind`, `useInstanceAABB`. Studio root (`App.tsx`) wraps with the provider. Subscription hooks use `useSyncExternalStore`. |
| 3 | Rendering layer reads geometry from app, not module-globals | ✅ Complete | `ObjectInstances.tsx`, `MapColliders.tsx`, `SelectionOutline` path in `SceneEditorCanvas.tsx`, `MapEditorCanvas.tsx` room bounds, `MoveController` picking — all consume `geometry.worldAABB` / `geometry.meshOrigin`. |
| 4 | Single SOT for geometry (`geometry.worldAABB`); no inline `+vs/2` or `voxelSize/2` math | ⚠️ Partial | Renderer + colliders + selection outline + Move tool picking all migrated. `ContextMenuListener` (`SceneEditorCanvas.tsx:961`), `moveOccupancy.ts:60-66`, `dropToSurface.ts:46-62`, and `roomSnap.snapToNearestTileableFace` still re-derive geometry locally. The `PrimitiveInstanceGroup` `+ voxelSize / 2` is a legitimate center-origin-BoxGeometry → bottom-anchored translation and is documented inline. See Critical #1 and Important #1. |
| 5 | DI everywhere; no module-level globals other than `defaultCatalogJson` import in `create-default-api` | ⚠️ Partial | The `object-kind-catalog.ts` shims were removed in Step 9. However `ObjectInstances.tsx:14, 44-46` still imports `defaultCatalogJson` at module scope to drive a `useGLTF.preload(...)` warm-up loop. Plan allows the bundled JSON as a dep — this is one indirection deeper but defensible as a renderer-side perf optimisation. See Minor #1. |
| 6 | Single Playwright bridge: only `window.officexrApi` + 3 sentinels | ✅ Complete | `HeadlessApp.tsx:23` sets `window.officexrApi = api`. Sentinels: `__officexrBakeResults`, `__officexrBakeDone` (BakeRunner), `__officexrBoundsReady` (BoundsScene). No other globals. |
| 7 | Geometry convention: X/Z center, Y bottom, no `+vs/2` legacy offset; uniform fallback | ✅ Complete | `geometry-service.ts:39-46` enforces it; `types.ts:85-93` documents the convention as part of the public interface; tests at `geometry-service.test.ts:77-122` pin it. |
| 8 | CLAUDE.md guardrails: zero `three` / `react` in sdk/realtime-server/core-refactor | ✅ Complete | Both greps return zero matches. |
| 9 | `lint:no-bespoke-renderer` stays clean | ✅ Complete | Passes. |
| 10 | App-layer tests: Blue cube + Cube Prototype Large A pin convention | ✅ Complete | `geometry-service.test.ts` pins both named kinds AND the unbaked-fallback. `bake-service.test.ts` injects a mock GLTF loader and asserts post-scale dims. `catalog-service.test.ts` covers bootstrap success/failure/notify. |
| 11 | Selection-outline test pins edge counts | ✅ Complete | `selectionOutline.test.ts` covers 0/1/2-stacked/2-disjoint/L-shape/2×2 slab/ring + the 2 m AABB and 2× adjacent 2 m AABB cases. |
| 12 | Visual regression test exists with checked-in baseline | ✅ Complete | `packages/world/scripts/test-bounds-visual.ts` + `test-bounds/blue-and-large-a.png` (73 KB PNG). `pixelmatch` + `pngjs` deps in `package.json`. `test:bounds-visual` script wired. |
| 13 | Programmatic bake replaces click-walk | ✅ Complete | `bake-kind-dimensions.ts` navigates to `?op=bake`, waits on `__officexrBakeDone`, reads `__officexrBakeResults`, PUTs the merged catalog. Sanity-checks for duplicate (w,h,d) buckets. |
| 14 | Deprecated module-global catalog shims removed | ✅ Complete | `object-kind-catalog.ts` now contains only a documentation header re-exporting types. All consumers route through `useApplication()` / `useCatalog()`. |
| 15 | Catalog re-baked | ✅ Complete | Step 8 commit `f2c8644` re-baked 281 kinds. Schema unchanged; `world-object-kinds.json` updated separately. |

**Compliance score: 11/15 fully met, 4 partial.** All four partials
are correctly attributed to consumer-rewire gaps (the geometry
service itself, the React context, and the renderer/colliders are
done). One of the partials (CLAUDE.md DIP via `bake-service.ts →
cube-material.ts`) is a knowingly-documented violation with stated
reasoning; the other three are real outstanding migrations.

---

## Issues Found

### Critical (must fix before shipping)

- **`packages/studio/src/modes/room/SceneEditorCanvas.tsx:961-971` —
  `ContextMenuListener` still uses single-voxel half-extents and a
  `+vs/2` Y offset for hit testing.**
  This is exactly the bug the plan's geometry SOT was meant to
  prevent. Right-clicking on a Cube Prototype Large A (4×4×4 m,
  AABB extending 2 m in each direction from voxel center on X/Z, 4 m
  up on Y) will hit-test against a 0.5 m cube centered on
  `(pos*vs, pos*vs + 0.25, pos*vs)` — i.e. the context menu will
  fail to open when the user right-clicks anywhere outside the
  center 0.5 m of the visible mesh. **Fix:** inject the geometry
  service into `ContextMenuListener` (the component is already a
  child of `useApplication()` consumers) and replace lines 961-971
  with the same `geomService.worldAABB(...)` + `rayHitAabb` pattern
  used by `MoveController` lines 1693-1698. Tests: add a unit test
  for `ContextMenuListener` hit-test resolution against a multi-
  voxel kind, OR (cheaper) add a Playwright smoke that places a
  Large A and right-clicks its corner.

### Important (should fix)

- **`packages/studio/src/modes/room/moveOccupancy.ts:54-67` — existing
  instances expand by `tileStep` from `position` going +X/+Y/+Z only,
  rather than from their canonical voxel footprint.**
  After the geometry refactor, a Blue cube placed at voxel `(0,0,0)`
  has canonical voxel footprint `(-2..2, 0..4, -2..2)` (per
  `geometry.voxelFootprint` test at `geometry-service.test.ts:113`),
  but `moveOccupancy` expands its occupancy as `(0..3, 0..3, 0..3)`.
  The two answers agree for moving a Blue cube against another Blue
  cube (both are wrong consistently), but they diverge for mixed
  kinds — e.g. moving a 1-voxel kind near a 4-voxel kind. The plan
  *explicitly* called this out as a Step 4/5 rewire: "Use
  `geometry.voxelFootprint` for both moving and existing instances."
  The implementer's own Step 4 review (`tasks/review-step-04.md`)
  documented the deferral. Step 5 shipped without the fix. **Fix:**
  rewire `checkMoveOccupancy` to compute footprints via
  `geometry.voxelFootprint(position, kindId)` for both the moving
  set AND the existing set. Update `moveOccupancy.test.ts` cases
  that hardcoded the lower-left convention; add at least one case
  with a multi-voxel mover crossing a multi-voxel occupant.

- **`packages/studio/src/modes/room/dropToSurface.ts:54-62` — gravity
  drop tests existing instances as single voxels at their bare
  `position`, ignoring kind dimensions.**
  A 2 m × 2 m cube placed at voxel `(0,0,0)` should be a valid drop
  target for any object whose voxel-XZ footprint overlaps cells
  `(-2..2)` on X and Z. Current code only treats voxel `(0,0,0)` as
  occupied, so any object centered at `(±2, _, ±2)` falls through.
  Plan said: "Use `geometry.worldAABB` for XZ overlap + Y settle."
  **Fix:** the helper takes a `worldObjects` snapshot — extend its
  signature to accept an `aabbLookup: (inst) => WorldAABB` (or the
  full geometry service) and check XZ-rect overlap against each
  existing instance's AABB; the new Y is then `max(supportAabb.max.y
  / voxelSize)` (ceil) instead of `iy + 1`.

- **`packages/world/src/app/bake-service.ts:19` — `import {
  getKindBoundingDimensions } from '../renderer/cube-material.ts'`
  drags THREE into the Application Layer at runtime.**
  The type-only `import type * as THREE from 'three'` is fine, but
  `cube-material.ts` does a runtime `import * as THREE from 'three'`
  on its first line and re-exports `getKindBoundingDimensions`. The
  plan's hard rule said "NO three.js" inside the app layer. The
  inline comment correctly flags this as a deliberate DIP violation
  per CLAUDE.md (cites: walking `THREE.Object3D` scene graphs is
  inherently THREE-coupled). The reasoning is sound and the comment
  is exactly what CLAUDE.md asks for, BUT the right fix is mechanical:
  move `getKindBoundingDimensions` into its own file under
  `packages/world/src/app/` (or `packages/world/src/geometry/`) and
  let `cube-material.ts` import IT, reversing the direction. The
  helper is 25 lines and has no other dependencies. Acceptable to
  ship now given the documentation; **not** acceptable to leave as
  the long-term shape — the next app-layer addition that needs a
  pure helper will copy the pattern.

- **No test execution evidence in `tasks/implementation-notes.md`
  for the three-layer refactor.**
  `implementation-notes.md` documents tasks 00..11 from the prior
  PR batch, not the nine steps of this refactor. The Step 2-6
  reviews in `tasks/review-step-0[2-6].md` are detailed and
  high-quality, but the implementer never updated
  `implementation-notes.md` with the refactor's deviations. The
  most important deviation (Steps 5/6 deferring moveOccupancy +
  dropToSurface rewires) lives only in commit messages and the
  per-step reviews. **Fix:** add a "Three-layer refactor" section
  to `implementation-notes.md` capturing the deferred work and the
  documented DIP violations so the next implementer doesn't
  rediscover them archaeologically.

### Minor (nice to fix)

- **`packages/world/src/renderer/ObjectInstances.tsx:14, 44-46` —
  module-level `useGLTF.preload(...)` loop reads
  `defaultCatalogJson` directly.**
  This is a renderer-side perf optimisation (warm drei's cache so
  the first paint doesn't flash). The plan explicitly allows the
  bundled default JSON as a bundled import. But the loop runs at
  module-load time before any `<ApplicationProvider>` is mounted,
  so it duplicates the JSON-read that `create-default-api` already
  does. Could be moved into a `useEffect` inside `ObjectInstances`
  that iterates `useCatalog()` (preloads everything in the live
  catalog, not just bundled defaults) — minor improvement.

- **Stale doc strings reference `getKindStride` after the symbol
  was removed.**
  - `packages/world/src/scenes/compile.ts:43`
  - `packages/studio/src/modes/room/moveOccupancy.ts:40`
  - `packages/studio/src/modes/room/roomSnap.ts:82`
  - `packages/studio/src/modes/map/MapEditorCanvas.tsx:311`
  None of these are live imports; just JSDoc lines that read stale.
  Fix in the same commit that addresses Important #1/#2.

- **`packages/studio/src/modes/room/roomSnap.ts:145-223` —
  `snapToNearestTileableFace` re-derives the X/Z-center, Y-bottom
  convention manually instead of consuming `geometry.worldAABB`.**
  The math at lines 198-208 is correct (matches the canonical
  convention) but duplicates it. If the convention ever changes
  again, this helper will silently drift. Acceptable scope —
  `snapToNearestTileableFace` is a pure function and its callers
  don't have the geometry service in their immediate scope. A
  future cleanup could pass the geometry service in as a dep.

- **`packages/world/src/physics/rules.ts:79-115` —
  `worldObjectsToCuboids` has a legacy fallback path for callers
  that don't pass `aabbLookup`.**
  Comment justifies it for "old bots without a catalog injected."
  This is a known transitional shim. Worth a TODO to delete once
  every caller is migrated; otherwise it will outlive its
  usefulness and someone will assume the legacy path is correct.

---

## What Looks Good

- **The geometry service interface is the right shape.** `worldAABB`,
  `worldAABBOfInstance`, `meshOrigin`, `voxelFootprint`, `tileStep` —
  all five answers a consumer might want, with consistent semantics,
  derived from one canonical implementation. The interface docstring
  at `types.ts:85-94` reads like a spec, not a description.
- **Tests pin the convention with named, motivating cases.** Blue
  cube + Cube Prototype Large A at `(0,0,0)` and `(4,0,0)`; unbaked
  fallback; the "flush adjacency" case. If anyone reintroduces
  `+vs/2`, every assertion in `geometry-service.test.ts:77-122`
  fails — and the failure messages name the right kinds.
- **`useInstanceAABB` regression guard.** The Step 2 fix
  (`eb47686`) caught a real bug where a `useMemo` deps list didn't
  include the catalog snapshot reference, so live `patchKind` edits
  returned stale AABBs. The fix migrated to `useSyncExternalStore`
  and added a regression test (`application-context.test.tsx:138-160`).
  That's the right way to use React-19's external-store idiom.
- **`MapColliders` rewrite.** The before/after comment at
  `MapColliders.tsx:11-26` explains the bug (players walked through
  2 m blocks) and the fix (collider half-extents = AABB
  half-extents) in three sentences. The `worldObjectsToCuboids`
  factoring in `physics/rules.ts` keeps the React component thin.
- **Headless harness is genuinely thin.** `HeadlessApp` is 50
  lines and does one thing: route by `?op=`. `BakeRunner` calls
  `api.bake.measureAll()` and writes the result; `BoundsScene`
  loads from `api.scenes.load(id)` and renders. The Playwright
  drivers (`bake-kind-dimensions.ts`, `test-bounds-visual.ts`) are
  ~140-170 lines each, mostly transport — exactly what the plan
  asked for.
- **Visual regression bridge.** The `ReadySignal` component
  counts 3 frames after Suspense resolves before flipping the
  sentinel — paranoid enough to absorb InstancedMesh matrix-update
  delay without being arbitrary. PNG diff with ~0.5% tolerance and
  written-to-disk diff on failure is the standard pattern, done
  well here.
- **Step-by-step review discipline.** `tasks/review-step-0[2-6].md`
  are real reviews — they catch real regressions, log deferrals
  explicitly, and suggest fixes. The `useInstanceAABB` patchKind
  bug was caught here, not in production. That's the multiplier on
  this whole effort.
- **DIP greps stay clean.** Both `grep -rn "from 'three'"
  packages/sdk packages/realtime-server packages/core-refactor` and
  the React variant return zero matches. The cross-package
  boundary the refactor was built around is intact.

---

## Test Coverage

| Area | Tests Exist | Coverage Notes |
|------|-------------|----------------|
| `InstanceGeometry` convention | Yes | `geometry-service.test.ts` — 9 cases, named kinds, fallback, voxelFootprint, tileStep, meshOrigin, constructor validation. Strong. |
| `CatalogService` | Yes | `catalog-service.test.ts` — 5 cases: default before bootstrap, successful replace, fallback on fetch fail, subscribers fire, ready() resolves immediately. |
| `BakeService` | Yes | `bake-service.test.ts` — 3 cases: per-kind, all-kinds skipping characters, unknown id throws. Mock GLTF loader injected. |
| `SceneService` | No | No dedicated test file. Acceptable — the service is a 1-of-N lookup; the visual regression test exercises it end-to-end. |
| `RoomService` | No direct | `compileScene` / `compileMap` are wrapped without behavioural changes; existing tests in `scenes/` cover them. |
| `useApplication` / `useCatalog` / `useKind` / `useInstanceAABB` | Yes | `studio/src/__tests__/application-context.test.tsx` — provider throws without ancestor, returns live api inside, `useCatalog` reflects patchKind, `useKind` re-renders, `useInstanceAABB` recomputes on dimension edits. |
| Selection outline | Yes | `selectionOutline.test.ts` — 8 cases, edge-count + AABB-extent assertions. Strong. |
| Move occupancy multi-voxel | Partial | `moveOccupancy.test.ts` exists and covers the moving-side footprint expansion. No case yet pins the asymmetric (proposed-multi-voxel vs existing-multi-voxel) bug — see Important #1. |
| Drop-to-surface | Partial | `dropToFloor.test.ts` covers the moving footprint vs single-voxel existing instances. No case yet pins the multi-voxel-support gap — see Important #2. |
| Room snap | Yes | `roomSnap.test.ts` — `computeTileStep`, `computeKindTileSteps`, `snapToVoxel` stride cases, `snapToNearestTileableFace` 5 cases. |
| Renderer instance AABB | Indirect | No unit test on `ObjectInstances.tsx`; covered by visual regression (`blue-and-large-a.png`). Acceptable — visual diff is the right level for "did the AABB-driven mesh land in the right pixels?" |
| Visual regression | Yes | `scripts/test-bounds-visual.ts` + checked-in baseline. Runs against the dev server; not automated in CI yet. |

**Test Coverage Assessment:** Strong on the application layer, the
geometry convention, and the React subscription hooks. The two gaps
(`moveOccupancy` asymmetric occupancy; `dropToSurface` multi-voxel
support) directly mirror the two Important issues — fix the
implementations and add the missing test cases in the same commit.

---

## Test Execution

| Check | Result | Details |
|-------|--------|---------|
| Test command discovered | Yes (`pnpm --filter @officexr/world test` + `... @officexr/studio test`) | From root `package.json` `scripts.test`. |
| `@officexr/world` test suite | Passed (161/161) | `Test Files 19 passed (19) / Tests 161 passed (161)`, 1.87s wall. |
| `@officexr/studio` test suite | Passed (179/179) | `Test Files 17 passed (17) / Tests 179 passed (179)`, 4.27s wall. |
| Typecheck — world | Passed | `tsc --noEmit` clean. |
| Typecheck — studio | Passed | `tsc --noEmit` clean. |
| `lint:no-bespoke-renderer` | Passed | "grep gate clean — no bespoke lighting / SEAM_OVERLAP outside renderer." |
| `lint:leva-free` | Passed | "grep gate clean — no Leva references found." |
| CLAUDE.md DIP greps | Passed | `from 'three'` and `from 'react'` in `packages/sdk packages/realtime-server packages/core-refactor` both return zero matches. |
| `test:bounds-visual` | Skipped | Requires running dev server (`pnpm dev:studio`); not run during this review. Baseline PNG is checked in. |
| `bake:dimensions` | Skipped | Same as above. Already executed for Step 8 (`f2c8644`). |
| Refactor evidence in implementation-notes | No | `implementation-notes.md` covers tasks 00..11 (prior PR). No section for the 9-step refactor. See Important #4. |

**Test Execution Assessment:** All Node-side tests pass. The
Playwright-driven scripts (visual regression, programmatic bake)
weren't run during this review — they require the dev server up and
are tested separately. The baseline PNG existing and being 73 KB of
non-trivial content suggests the visual regression has been run at
least once to seed it.

---

## TDD Compliance

| Task | Tests Written | Tests Adequate | TDD Skipped Reason Valid | Notes |
|------|---------------|----------------|--------------------------|-------|
| Step 1 — Application Layer | Yes | Yes | N/A | Three dedicated test files; pin named kinds + fallback + bootstrap modes; assertions on concrete numerics. |
| Step 2 — React context | Yes (added in `eb47686`) | Yes | N/A | `application-context.test.tsx` covers all four hooks; the `useInstanceAABB` regression test pins the specific bug Step 2 review caught. |
| Step 3 — Renderer + Colliders | No direct unit tests | Adequate via visual regression | Yes, visual regression is the right level | Pixel-diff against checked-in baseline catches AABB drift end-to-end. |
| Step 4 — Selection outline + snap consume geometry | Yes | Yes | N/A | Existing `selectionOutline.test.ts` updated; tests pin 2 m AABB → 2 m wireframe + 2 m + 2 m flush adjacency edge dedup. |
| Step 5 — Remaining callers | Partial | Partial | No | `moveOccupancy` and `dropToSurface` rewires deferred without a replacement task or follow-up commit; their existing tests still encode the lower-left-anchored convention. See Important #1/#2. |
| Step 6 — Headless mode | Indirect | Adequate | Yes — exercised by the bake + visual regression scripts | No unit test for `HeadlessApp` routing; it's 50 lines of dispatcher that's exercised by both Playwright drivers. |
| Step 7 — Visual regression infra | N/A (infrastructure) | N/A | N/A | The infrastructure IS the test; baseline + diff threshold sufficient. |
| Step 8 — Catalog re-bake | N/A (pure data) | N/A | N/A | |
| Step 9 — Remove shims | Indirect | Adequate | Yes — typecheck + existing tests catch any straggler | Any remaining `import` of the deleted symbol would fail TS compile. |

**TDD Assessment:** Steps 1, 2, 4 have meaningful new tests pinning
the convention with concrete kind-named cases. Steps 5/6 have an
adequacy gap — see Important #1/#2 — but the cause is the deferral
itself, not a TDD-discipline failure.
**Test Adequacy:** all new test files exercise the SUT against real
inputs and assert on real outputs. No `expect(thing).toBeDefined()`
shortcuts. The `selectionOutline` and `geometry-service` tests in
particular are exemplary — every assertion references a concrete
number that ties back to a specific kind + position.

---

## Implementation Decision Review

| Step | Decisions Documented | Decisions Sound | Flags |
|------|---------------------|-----------------|-------|
| 1 | Yes (in source comments) | Yes | One DIP violation in `bake-service.ts` cites CLAUDE.md format. Acceptable per the guardrail; see Important #3 for the longer-term fix. |
| 2 | Yes (commit message + Step 2 review) | Yes | `useSyncExternalStore` migration is correct under Concurrent + Strict Mode. `useInstanceAABB` cannot use uSES directly because each call allocates a fresh `{min,max}` object; documented + worked around with a snapshot-ref-as-memo-key pattern. |
| 3 | Yes (`MapColliders.tsx:11-26` is a model docstring) | Yes | Before/after explanation pinpoints the bug (players walking through 2 m blocks). `worldObjectsToCuboids` factoring into `physics/rules.ts` keeps physics React-free. |
| 4 | Yes (Step 4 review) | Yes — within scope | Selection-outline pure-function extraction + AABB-takes-`WorldAABB[]` is the right factoring. Step 4 review correctly flags the `moveOccupancy` / `dropToSurface` deferral to Steps 5/6. |
| 5 | Partial | Partially — see Important #1/#2 | The Step 5 commit migrated the easy "remaining catalog/compile callers" but did not address the deferred moveOccupancy + dropToSurface work. The Step 6 review doesn't pick it up either. The deferral has now compounded across two steps. |
| 6 | Yes | Yes | HeadlessApp dispatcher is 50 lines; BakeRunner / BoundsScene each ~90 lines; single Playwright bridge as planned. |
| 7 | Yes | Yes | 0.5% pixel tolerance + `pixelmatch` threshold 0.1 + 3-frame wait is the conservative, well-known recipe. Diff PNG on failure is correctly written to disk for postmortems. |
| 8 | N/A (pure data) | N/A | |
| 9 | Yes (the stub left in `object-kind-catalog.ts` is itself a documented "everything moved" beacon) | Yes | Stub file is the right pattern — fail loudly on stale imports rather than silently re-exporting deleted globals. |

**Decision Assessment:** The architecture decisions are uniformly
good. The implementer made the right call on every documented
deviation EXCEPT the moveOccupancy / dropToSurface deferral — that
one needed either to be done in Step 5 (the plan's wording) or
explicitly converted into a follow-up task with a date, and it was
neither. The pattern that produced the original god-component bug
(silent deferral compounding across steps) is the one to guard
against most carefully here; the fix is small but the discipline
matters.

---

## Recommendations

In priority order:

1. **Fix `ContextMenuListener` (Critical).** ~30 lines, mirrors the
   already-correct pattern at `MoveController` lines 1690-1704.
   Same commit: add a Playwright smoke test that places a Large A
   and right-clicks its corner.
2. **Rewire `moveOccupancy.ts` and `dropToSurface.ts` to
   `geometry.voxelFootprint` / `geometry.worldAABB` (Important #1 +
   #2).** This closes the plan's Step 5 obligation. Update the
   existing tests; add two new cases each pinning the
   multi-voxel-existing-instance behaviour. ~60 lines + ~80 lines
   of tests.
3. **Extract `getKindBoundingDimensions` out of
   `renderer/cube-material.ts` and put it where the app layer can
   reach it without crossing the renderer boundary (Important #3).**
   25 lines moved; cube-material.ts re-exports it for back-compat.
   Removes the documented DIP violation.
4. **Add a "Three-layer refactor" section to
   `tasks/implementation-notes.md` (Important #4).** Capture: the
   documented DIP violations and their rationale; the deferred
   work and when it was paid down; any other architectural shims
   left in place (the `worldObjectsToCuboids` legacy fallback).
5. **Sweep doc-string mentions of `getKindStride` (Minor #2).**
   Four sites; trivial.
6. **(Optional) Move the renderer's `useGLTF.preload` loop into a
   `useEffect` over `useCatalog()` (Minor #1).** Only worthwhile
   if you want to preload non-default kinds too; ignorable
   otherwise.

After (1) and (2): ship. The foundation is in place, the
conventions are pinned by tests, and the bridge to the headless
test harness is the right one. The remaining cleanup is
incremental and unblocks no downstream work.
