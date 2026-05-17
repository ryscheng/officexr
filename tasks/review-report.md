# Code Review Report — `ravenac95/officexr-studio`

**Scope:** commits `8e47549` … `bded267` (13 commits, tasks 00–11 + 1 follow-up fix)
**Spec:** `tasks/updated-prd.md`
**Reviewer:** code-reviewer agent, 2026-05-17

---

## Summary

The branch implements all 12 tasks from the PRD. All 158 world tests + 169 studio tests pass, the studio build succeeds, the no-bespoke-renderer lint is clean, and the DIP grep guards (`from 'three'` / `from 'react'` in sdk/realtime-server/core-refactor) return zero matches. The `placeCube` → `placeObject` rename is fully propagated to the editor path; the follow-up fix commit (`bded267`) caught the remaining call-sites in `applyAction.ts`, `InspectorPanel.tsx`, and `moveDelta.ts` that the orchestrator missed. SOLID guardrails are honoured. One **Important** issue (an unused `useRef` mirror introduced in task-09) and a handful of **Minor** issues remain.

**Verdict: ship-after-minor-cleanup.** No critical defects.

**Overall compliance: 92/100.**

---

## PRD Compliance

| # | Requirement | Status | Notes |
|---|---|---|---|
| 0 | Rename `cube-kind` → `world-object-kind` (identifiers + filenames + API path) | ✅ Complete | All canonical names introduced; deprecated aliases re-exported (see `cube-kinds-schema.ts` shim, `world-object-kinds-schema.ts:209-219`). |
| 1 | Add `tilingAxes`, `gravity`, `optimization` to `WorldObjectKind` with category-conditional defaults | ✅ Complete | `world-object-kinds-schema.ts:43-81`, defaults handled in `normalizeKind` and `normalizeTilingAxes`. |
| 2 | Bump `RoomDocument` to v4, multiply positions ×4, rewrite `op:'placeCube'` → `op:'placeObject'`, migrate on load | ✅ Complete | `serialize.ts:281-312` (`migrateRoomV3toV4`); v4 wired through `migrateToV4`. All on-disk rooms at `schemaVersion: 4`. |
| 3 | Replace hardcoded `voxelSize = 2` with the single `VOXEL_SIZE = 0.5` constant | ✅ Complete | `config.ts:7` + downstream `cubeSize: VOXEL_SIZE` field renames; `useRoomDocument.ts:151` reads `VOXEL_SIZE`. |
| 4 | Per-object snap step + multi-voxel occupancy | ⚠️ Partial | `computeTileStep`, `computeKindTileSteps`, stepped `snapToVoxel` present (`roomSnap.ts:46-93`). `checkMoveOccupancy` takes a `footprint` arg (`moveOccupancy.ts:24-57`) — but see Important issue #1: it only expands the *moving* object's footprint and treats every *existing* instance as a single voxel. |
| 5 | Snap non-tileable kinds to nearest tileable face, ≤5 m radius fallback to world grid | ⚠️ Partial | `snapToNearestTileableFace` present and tested (`roomSnap.ts:126-204`); SceneEditorCanvas wires it on Add tool. But the call-site in `SceneEditorCanvas.tsx:369-381` passes a `voxelSize`-cube default dims for *all* tileable instances (see Important issue #2). |
| 6 | Drop-to-surface for gravity-enabled objects; reject placement with no support | ✅ Complete | `dropToSurface.ts` returns `null` when no support; both `handleAddClick` (line 499-503) and `handleTileClick` idle stage (line 540-545) honour rejection. World-floor (y=0) is intentionally NOT a valid support per the user clarification. |
| 7 | Tiling/Placement/Optimization sections in `ObjectKindEditorPanel` | ✅ Complete | `ObjectKindEditorPanel.tsx:166-200`; Optimization shows `"scaffold — no runtime effect"` hint. |
| 8 | Generalize `TileState` to per-kind axes, extract pure module | ✅ Complete | `tileStateMachine.ts` (resolveAvailableAxes, computeTileGhosts, switchNextAxis); SceneEditorCanvas consumes them. Y-axis screen-delta correctly documented as inline SRP exception (line 438-441). |
| 9 | X/Y/Z keyboard shortcut + on-screen hint | ✅ Complete | `SceneEditorCanvas.tsx:320-332` + hint at line 803-822. Hint only shows when `remainingAxes.length > 1` per spec. |
| 10 | `<DirectionGizmo>` primitive in `packages/world/src/renderer/`, composed in `SceneEditorCanvas` | ✅ Complete | `DirectionGizmo.tsx` exported via `renderer/index.ts:38`; consumed at `SceneEditorCanvas.tsx:795-801`. Anti-parallel direction handled correctly (`DirectionGizmo.tsx:44-48`). |
| 11 | Integration lint + build verification | ✅ Complete | All grep guards / lint scripts / tests / build pass. |

**Compliance score: 10/12 fully met, 2/12 partial.**

---

## Issues Found

### Critical (must fix before merge)

*(none)*

### Important (should fix)

1. **`packages/studio/src/modes/room/SceneEditorCanvas.tsx:315-318` — dead `tileStateRef` mirror.**
   The ref is declared and synchronised but never read; the keydown handler in the same component uses the `setTileState((prev) => …)` callback form to access the latest state. Per CLAUDE.md, "no new `useRef + setState` mirror pairs" — even an unused mirror is the wrong shape. **Fix:** delete the two lines. Either keep the ref and use it as the original task-09 design suggested, or drop it. (The task spec explicitly permits the ref pattern, so this is style-not-correctness, but the dead code obscures intent.)

2. **`packages/studio/src/modes/room/moveOccupancy.ts:35-39` — occupancy ignores multi-voxel existing instances.**
   The function expands the *proposed* footprint but the occupancy set is built from `c.position` of each `placeObject`, treating every existing object as a single voxel. After task-04, a 2×2×2 block on the 0.5 m grid occupies a 4×4×4 voxel footprint. A move tool drag that ends inside the un-mapped 63 phantom-empty voxels of such a block will pass the occupancy check and overlap the block. **Fix:** when building `occupancy`, look up each command's kind, compute its tileStep, and expand the set to all `[x, x+w) × [y, y+h) × [z, z+d)` cells. The PRD's task-04 requirement explicitly says "checkMoveOccupancy must expand to cover all voxels within the object's bounding box footprint" — only the moving side is implemented.

3. **`packages/studio/src/modes/room/SceneEditorCanvas.tsx:369-381` — `tileableObjects` always uses a 1-voxel cube as the dims approximation.**
   The implementation note documents this as ISP-bounded ("getKindBoundingDimensions requires GLTF scene context"), and that's fair as a *temporary* shim. But the consequence is that `snapToNearestTileableFace` will pick the wrong face for any tileable object whose real dims differ from `voxelSize × voxelSize × voxelSize` — i.e. all of the original KayKit BlockBits (2 m cubes on the 0.5 m grid → 4-voxel cubes). For a furniture piece placed next to a block, the "+X face" the chair snaps against will be off by 1.5 m (the block's actual half-width minus 0.25 m). **Fix:** plumb `kind.boundingDims` (or whatever the runtime equivalent is) into the `useMemo`, or expose a memoised cache from the renderer. Acceptable to ship now if you note this as a known limitation; not acceptable if furniture-placement is a load-bearing feature of this PR.

### Minor

4. **`packages/world/rooms/` — task-02 acceptance criterion lists 5 room JSONs (default, default-v2, platform, meeting-room-1, test-room) but only 3 exist on disk.** `git status` at session start showed `meeting-room-1.json` and `test-room.json` as untracked. They are no longer present. Either they were never created and the PRD is stale, or they were deleted. Reconcile: either drop them from the task spec, or commit migrated versions.

5. **`packages/world/src/renderer/ObjectInstances.tsx:270-273` — TODO comment is accurate but `kind.optimization` is not actually read in the file.** Implementation notes claim "kind.optimization is read but not yet acted on" — the comment says the same. Neither is true: the field is never destructured. Harmless, but the comment language is misleading. Either read the value and store it on a no-op variable to make the TODO honest, or rephrase the comment ("when the path is implemented, branch on kind.optimization here").

6. **`packages/studio/src/modes/room/SceneEditorCanvas.tsx:11-17` — `ROOM_EDITOR_LIGHTING` const declaration sits between two imports.** Style nit — declaration in the middle of an import block. Move below the import group.

7. **`tasks/implementation-notes.md` (task-01) — claims a "Zod schema" but `world-object-kinds-schema.ts` is hand-rolled validation.** No Zod dependency added. Note is stale; reword.

8. **`tasks/implementation-notes.md` (task-02) — claims `applyAction.ts`, `InspectorPanel.tsx`, and `moveDelta.ts` "still check for `'placeCube'`" as a pre-existing issue.** The follow-up commit `bded267` has since fixed these. Implementation notes should be amended so a future reviewer doesn't chase ghosts.

9. **`packages/studio/src/modes/room/Vector3Input.tsx:23` & `InspectorPanel.tsx:30` — JSDoc comments still reference "placeCube".** Comments only — no runtime effect — but rename for consistency.

10. **`packages/world/src/scenes/map-document.ts:24` — comment refers to "`placeCube` commands".** Same cosmetic issue; update text to `placeObject`.

11. *(retracted on re-check — `ObjectKindEditorPanel.tsx:206` does re-export `KindEditorPanel` as an alias, so the shim is valid.)*

---

## What Looks Good

- **Generalized tile state machine** (`tileStateMachine.ts`) is a textbook SRP/OCP split — pure state-transition logic decoupled from the React/R3F event surface, with the inline SRP exception (Y-axis screen-delta) called out by comment.
- **`DirectionGizmo`** is a clean renderer primitive: composes `cylinderGeometry` + `coneGeometry`, handles the `direction = [0,-1,0]` anti-parallel quaternion singularity, and lives in `packages/world/src/renderer/` per the DIP rule.
- **`dropToSurface`** is a pure function with thorough test coverage (7 cases including empty world, stacked supports, out-of-footprint, and multi-voxel footprint). Footprint-overlap math (half-floor / half-ceil) is correct.
- **Migration test suite** (`migration.test.ts`) covers all five acceptance criteria explicitly — including the idempotence guard and the round-trip serialize → deserialize.
- **Capability-field defaults** are category-conditional (`block` → all-axes tileable; everything else → non-tileable) and unit-tested across categories.
- **Per-commit hygiene** — every commit touches the files for exactly one task, no cross-cutting bundles. The follow-up `bded267` fix is correctly isolated.
- **Backward-compat alias strategy** in `world-object-kinds-schema.ts:209-219` lets the rename land without a Big Bang refactor of every call-site — pragmatic and well-documented.

---

## Test Coverage

| Area | Tests Exist | Coverage Notes |
|------|-------------|----------------|
| WorldObjectKind schema (capability defaults) | Yes | `world-object-kinds-schema.test.ts` — 11 tests covering category-conditional defaults, explicit overrides, and invalid-input fallback for each new field. |
| v3→v4 migration | Yes | `migration.test.ts` — 7 tests covering ×4 positions, op rewrite, extrude pass-through, schema bump, idempotence, deserialize accepts v4, round-trip. |
| `VOXEL_SIZE` change | Indirect | Compile / room-storage / catalog tests all run on the new value; no dedicated test, none needed. |
| Per-object snap step + occupancy | Yes | `roomSnap.test.ts` (computeTileStep, computeKindTileSteps, stepped snapToVoxel), plus `moveOccupancy.test.ts` for the multi-voxel footprint. **Gap:** see Important #2 — no test pins the asymmetric (proposed-multi-voxel vs existing-single-voxel) bug. |
| Snap to nearest tileable face | Yes | 5 tests in `roomSnap.test.ts` covering empty-world fallback, radius fallback, flush-+X, flush-+Y, nearest-by-distance tie-break. |
| Drop-to-surface | Yes | `dropToFloor.test.ts` — 7 tests. |
| Tile state machine (pure parts) | Yes | `tileStateMachine.test.ts` — covers `resolveAvailableAxes` (4 cases), `computeTileGhosts` (4 cases including step=4), `switchNextAxis` (3 cases). |
| ObjectKindEditorPanel UI | No | Per PRD's "TDD OFF for UI" policy. |
| Keyboard shortcuts + hint UI | No | Per PRD's "TDD OFF for UI" policy. |
| `DirectionGizmo` | No | Per PRD's "TDD OFF for rendering" policy. |

**Test Coverage Assessment:** strong. All TDD-mode tasks (01, 02, 04, 05, 06, 08) have test files that exercise the pure logic with specific value assertions, not type/existence checks. Test adequacy spot-check passes — every test calls the SUT and asserts on values.

---

## Test Execution

| Check | Result | Details |
|-------|--------|---------|
| Test command discovered | Yes (`pnpm --filter @officexr/world test` + `… @officexr/studio test`) | From `packages/*/package.json` and task spec. |
| World test suite | Passed (158/158) | 16 files, 2.18 s. |
| Studio test suite | Passed (169/169) | 16 files, 5.14 s. |
| Studio build | Passed | Bundle 4.5 MB (pre-existing warning about chunk size). |
| `lint:no-bespoke-renderer` | Passed | "grep gate clean". |
| `grep "from 'three'"` in sdk/realtime-server/core-refactor | 0 matches | DIP intact. |
| `grep "from 'react'"` in sdk/realtime-server/core-refactor | 0 matches | DIP intact. |
| `grep "'placeCube'"` in source (excl. migration + tests + docs) | 0 matches | Rename complete after `bded267`. |
| Inline `<directionalLight>` / `<ambientLight>` / `<hemisphereLight>` / `SEAM_OVERLAP` outside renderer | 0 matches | Confirmed by lint script + manual grep. |
| TDD evidence in implementation-notes | Yes | Each TDD task documents the test file path. |

**Test Execution Assessment:** all gates pass.

---

## Per-Task Verdict

| Task | Verdict | Rationale |
|------|---------|-----------|
| 00 — rename cube-kind → world-object-kind | ✅ | Canonical names introduced, deprecated aliases preserved, no broken imports. |
| 01 — capability fields on WorldObjectKind | ✅ | Schema updated with category-conditional defaults; 11 dedicated tests pass. |
| 02 — RoomDocument v4 + ×4 migration | ✅ | Migration is pure, tested, idempotent; on-disk room JSONs at v4. |
| 03 — VOXEL_SIZE = 0.5 | ✅ | Single source of truth in `config.ts`; consumers reference the constant. |
| 04 — per-object snap step + multi-voxel occupancy | ⚠️ | Snap-step math correct, but `checkMoveOccupancy` does not expand existing instances (see Important #2). |
| 05 — snap non-tileable to nearest face | ⚠️ | Pure function correct + tested. The canvas wiring approximates all tileable-object dims as 1-voxel cubes (see Important #3). |
| 06 — drop-to-surface gravity | ✅ | World-floor-is-not-support semantics honoured at both `handleAddClick` and `handleTileClick`. |
| 07 — ObjectKindEditorPanel capability sections | ✅ | All three sections present with correct controls + scaffold label. |
| 08 — generalize tile state machine | ✅ | Pure module extracted with full coverage; SRP exception (Y-axis screen-delta) is documented per CLAUDE.md. |
| 09 — X/Y/Z keyboard switch + hint | ⚠️ | Behaviour correct; dead `tileStateRef` mirror should be removed (Important #1). |
| 10 — DirectionGizmo primitive | ✅ | Lives in renderer, composed in canvas, anti-parallel edge case handled. |
| 11 — integration verification | ✅ | All gates clean. |

---

## TDD Compliance

| Task | Tests Written | Tests Adequate | TDD Skipped Reason Valid | Notes |
|------|--------------|---------------|--------------------------|-------|
| 01 | Yes (`world-object-kinds-schema.test.ts`) | Yes | N/A | 11 cases, specific value assertions for each category × each new field. |
| 02 | Yes (`migration.test.ts`) | Yes | N/A | 7 cases including idempotence + round-trip. |
| 04 | Yes (`roomSnap.test.ts`, `moveOccupancy.test.ts`) | Yes | N/A | Per-axis stepped snapping pinned with concrete numerics. |
| 05 | Yes (`roomSnap.test.ts`) | Yes | N/A | 5 cases incl. fallback radius + tie-break. |
| 06 | Yes (`dropToFloor.test.ts`) | Yes | N/A | 7 cases incl. multi-voxel footprint. |
| 08 | Yes (`tileStateMachine.test.ts`) | Yes | N/A | 11 cases across all 3 exported functions. |

**TDD Assessment:** all six TDD-mode tasks shipped with tests that exercise the SUT against concrete inputs and assert on concrete outputs. No tests of the form `expect(thing).toBeDefined()` only. Spec-style assertions throughout.

**Test Adequacy:** 6/6 TDD tasks meaningfully covered. 0 weak tests flagged.

---

## Implementation Decision Review

| Task | Decisions Documented | Decisions Sound | Flags |
|------|---------------------|-----------------|-------|
| 00 | Yes | Yes | Alias-shim trade-off explicit; correct call. |
| 01 | Yes | Mostly | Notes mention "Zod schema" but implementation is hand-rolled — comment is stale (Minor #7). |
| 02 | Yes | Mostly | Notes claim three files have pre-existing TS errors; `bded267` has since fixed them — stale (Minor #8). |
| 03 | Yes | Yes | — |
| 04 | Yes | Mostly | Footprint asymmetry in occupancy not flagged (Important #2). |
| 05 | Yes | Mostly | Dims approximation documented as ISP boundary; OK as a known simplification but should be tracked as follow-up (Important #3). |
| 06 | Yes | Yes | "World floor not a valid support" called out, matches user clarification. |
| 07 | Yes | Yes | — |
| 08 | Yes | Yes | SRP violation (Y-axis screen-delta) documented inline per CLAUDE.md. |
| 09 | Yes | Mostly | Ref mirror documented as intent but ended up unused — Important #1. |
| 10 | Yes | Yes | `depthTest:false + renderOrder=1` trade-off named. |
| 11 | Yes | Yes | — |

**Decision Assessment:** implementers made defensible calls and documented trade-offs. Two notes (Minor #7, Minor #8) need refresh now that follow-up work has landed. No decision-level concerns.

---

## Recommendations

In priority order:

1. **Fix Important #2 (occupancy asymmetry).** Either expand the occupancy set to multi-voxel existing instances, or pin the limitation in a test + document as a known issue. Today's behaviour will silently allow object overlaps in any non-1×1×1 scenario.
2. **Fix Important #3 (tileableObjects dims approximation)** or accept it as a deliberate v1 shipping. If accepted, file a follow-up task and add a `// TODO(furniture-snap-dims)` at `SceneEditorCanvas.tsx:370`.
3. **Delete the unused `tileStateRef`** (Important #1) — single 2-line cleanup.
4. **Refresh `tasks/implementation-notes.md`** for tasks 01 and 02 (Minor #7, #8).
5. **Reconcile the missing room files** (Minor #4): drop `meeting-room-1.json` / `test-room.json` from task-02's acceptance criteria, or commit them.
6. Address the remaining Minor cosmetic items (comments referencing "placeCube" in JSDoc) opportunistically.

**Ship/fix-then-ship/rework: fix-then-ship.** Items #1–3 should land before merge to main; the remainder can ship as follow-ups.
