# Code Review — c31eb9a (Step 4: selection outline + snap consume geometry SOT)

## Summary

The migration of `SelectionOutline`, `stepForKind`, `tileableObjects`,
`snapForAdd`, and `MoveController` onto the `InstanceGeometryService`
and `CatalogService` via `useApplication()` is correct, clean, and
faithful to the three-layer architecture intent. The selection
wireframe now genuinely shares one source of truth with the renderer.
Verdict: ship it, with several non-blocking follow-ups for ad-hoc AABB
math that survives elsewhere in this same file (per the plan, those
land in Steps 5/6).

**Architecture-alignment grade: A−**. Step 4's stated scope is
executed cleanly; one B/C-ergonomic miss (an exhaustive-deps gap, a
dead import) and one Important visibility flag for legacy AABB math
still living in this file that the plan defers to a later step.

---

## PRD / Plan Compliance

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| 1 | `SelectionOutline` derives AABBs from `geomService.worldAABB` | Complete | `SceneEditorCanvas.tsx:1056` — calls `geomService.worldAABB(inst.position, inst.kindId)` and feeds the result straight to `outlineEdgePositions`. Same service the renderer uses → wireframe sits ON the mesh by construction. |
| 2 | `outlineEdgePositions` is a pure edge emitter on `WorldAABB[]` | Complete | `selectionOutline.ts:36-90`. No voxel/dims interpretation, no `voxelSize` arg. Pure dedup. |
| 3 | `stepForKind` uses `geomService.tileStep` (not `getKindStride`) | Complete | `SceneEditorCanvas.tsx:369-376`. Destructures `[x,y,z]` from `tileStep`. |
| 4 | `MoveController` reads `geomService` correctly | Complete | Destructured at `SceneEditorCanvas.tsx:1618`, used at 1817. Resolves correctly. |
| 5 | Pure functions receive injected data (no globals) | Complete | `outlineEdgePositions(aabbs)`, `checkMoveOccupancy(..., kindFootprint)`, `dropToSurface(voxel, footprint, compiled)`, `snapToVoxel(hit, vs, step, targetStride)` — every dimension/step/AABB is passed as an arg. |
| 6 | Zero `getKind` / `getKindStride` imports in this file | Complete | `grep` confirms no `object-kind-catalog` imports and no `getKindStride` references survive in `SceneEditorCanvas.tsx`. |
| 7 | Tests pass | Complete | `pnpm --filter @officexr/studio test` → 17 files, 179 tests passing. |

**Compliance Score: 7 / 7** for Step 4's stated scope.

---

## Issues Found

### Critical
*None.* Nothing in this commit blocks shipping.

### Important

- **`SceneEditorCanvas.tsx:1697-1711` — ad-hoc AABB picking math in
  `MoveController`'s `onPointerDown`.** This still hand-rolls
  `cy = inst.position[1]*cs + cs/2` and `half = cs/2`, i.e. the
  legacy lower-left+half-voxel-offset model. For any kind whose
  baked dimensions differ from one voxel (the 2 m Blue cube, the
  4 m Large A), this AABB no longer matches what the renderer
  draws — picking will miss/false-hit on large objects. Replace with
  `geomService.worldAABB(inst.position, inst.kindId)` and call
  `rayHitAabb(...origin..., aabb.min, aabb.max)`. The plan flags
  this kind of consumer for the same SOT treatment; defensible to
  defer (Step 5/6 territory) but it should be on the next-step
  checklist explicitly.

- **`SceneEditorCanvas.tsx:1780-1784` — Y-axis drag projection uses
  `state.startVoxel[1]*cs + cs/2`.** Same legacy offset. For a 2 m
  cube the projected screen-Y will be a half-voxel too high, so the
  `PIXELS_PER_VOXEL` mapping starts from the wrong anchor. Resolves
  with the same fix — derive the world-space anchor from
  `geomService.meshOrigin(...)` or the AABB centroid.

- **`SceneEditorCanvas.tsx:1872-1883` — `useEffect` deps array in
  `MoveController` omits `geomService`.** The closure at line 1817
  reads `geomService.tileStep`, but the effect doesn't re-subscribe
  if `geomService` changes. In practice `geomService` is stable
  across renders (single instance from `<ApplicationProvider>`), so
  this won't bite at runtime — but if a test ever swaps providers
  it will silently use the stale reference. Add it for correctness,
  and to satisfy `react-hooks/exhaustive-deps`.

- **`SceneEditorCanvas.tsx:401-415` and `:422-451` — exhaustive-deps
  gaps for `catalogService`.** `tileableObjects` reads
  `catalogService.getKind` but its deps list is
  `[props.compiled.instances, fallbackDims]`. Same omission in
  `snapForAdd`'s deps at line 450. Stable-instance argument applies,
  but lint will (correctly) yell. Add `catalogService` to both.

- **`SceneEditorCanvas.tsx:59` (`checkMoveOccupancy` integration via
  `tileStep`) — semantic mismatch with geometry centering.** The
  geometry service centers AABBs on X/Z (`voxelFootprint` returns a
  centered cell range, e.g. `(-2,0,-2)..(2,0,2)` for the 2 m cube),
  but `moveOccupancy.ts` still expands `(ox..ox+w, oy..oy+h,
  oz..oz+d)` — positive-axis only, lower-left anchored. The commit
  passes `tileStep` here, preserving the pre-existing (wrong for
  centered geometry) convention. The plan's Step 5/6 calls for
  rewiring `moveOccupancy` onto `geometry.voxelFootprint`; this
  commit faithfully kicks the can. Flagging so the deferral is
  explicit, not silent.

### Minor

- **`SceneEditorCanvas.tsx:29` — dead import.** `type Vec3 as
  VoxelVec3` from `selectionOutline.ts` is imported but never used.
  Drop it.

- **`SceneEditorCanvas.tsx:1063-1067` — `voxelSize` in
  `SelectionOutline`'s `useMemo` deps is intentionally listed
  with a comment explaining the linter dance.** The comment is
  correct, but cleaner is to simply remove `voxelSize` from props
  (the geometry service owns it) and from the deps array — no
  eslint-disable required. The component receives `voxelSize`
  but no longer uses it for the outline math.

- **`selectionOutline.ts:23` — `Vec3` is exported but no longer
  needed by callers** since the file now exports `WorldAABB`
  exclusively for input shape. Harmless, but tidier to drop once
  no consumer imports it.

- **No implementation note for this step.** `tasks/implementation-notes.md`
  has no entry covering the selectionOutline + tileStep migration.
  The architectural decision (centered-AABB SOT vs preserved
  lower-left occupancy math) is exactly the kind of thing that
  deserves a paragraph there.

---

## What Looks Good

- **`outlineEdgePositions` is exemplary SRP.** One job: dedupe edges
  of a set of AABBs. The function is now obviously testable without
  any catalog/voxel context. The 9 rewritten tests read clearly.
- **The wireframe-matches-mesh property is now structural, not
  enforced by hand.** Because the renderer and the outline both call
  `geomService.worldAABB`, no future refactor of the Y convention or
  per-kind dimension fallback can drift them apart — they share the
  function call.
- **DIP is respected.** `SceneEditorCanvas` is a UI-layer file; it
  imports `useApplication` and consumes `geometry` + `catalog`
  through interfaces. No imports of `getKind` / `getKindStride` /
  `object-kind-catalog` survive.
- **Step 4's scope discipline.** The commit doesn't try to rewire
  `moveOccupancy.ts` or `dropToSurface.ts` (Steps 5/6). It just
  swaps the call sites in the canvas + the outline. Reviewable diff.
- **Test consolidation justified.** The dropped 180th test
  (`coords scale by voxelSize when the position is non-zero`) was
  testing an integration concern — that `outlineEdgePositions`
  multiplies coordinates by `voxelSize`. The new function doesn't;
  the geometry service does, and is tested in
  `packages/world/src/app/__tests__/geometry-service.test.ts`. No
  loss of meaningful coverage.

---

## Test Coverage

| Area | Tests Exist | Coverage Notes |
|------|-------------|----------------|
| `outlineEdgePositions` pure dedup | Yes | 9 tests cover empty, single, stacked, disjoint, L, slab, 2 m AABB, two adjacent 2 m, ring. Asserts both edge counts AND max coords. |
| `SelectionOutline` React wiring | Indirect | No direct component test, but the geometry-service AABB output is unit-tested upstream, and the wiring through `geomService.worldAABB` is trivial enough that integration via the live editor is sufficient. |
| `MoveController` `geomService.tileStep` call | No | The drag/occupancy path isn't unit-tested at the component level. `checkMoveOccupancy` is unit-tested separately. |
| Tile-tool snap + step | Indirect | `roomSnap` and `tileStateMachine` are well-tested as pure modules; the SceneEditor wiring isn't covered by component tests. |

**Test Coverage Assessment**: Adequate for Step 4's scope. The pure
extractables are well-tested; the React glue relies on integration
testing in the live editor and on the upstream geometry-service unit
tests.

---

## Test Execution

| Check | Result | Details |
|-------|--------|---------|
| Test command discovered | Yes (`pnpm --filter @officexr/studio test`) | From `package.json` `scripts.test`. |
| Test suite run | Passed (179/179) | 17 files, 179 tests; runtime ~3.8 s. |
| TDD evidence in implementation notes | No | No `implementation-notes.md` entry for this step's migration. Commit message itself documents "179 tests pass (was 180); tsc clean" — that's evidence of running, but not in the notes file. |

**Test Execution Assessment**: Clean pass. Commit message matches
observed test count exactly. Add an implementation note covering this
step's architectural decisions (centered-AABB SOT, deferred occupancy
rewire) for future archaeology.

---

## Recommendations

Priority-ordered. Items 1-3 should land before the broader Step 5/6
sweep so they don't compound; item 4 is cosmetic.

1. **Fix `MoveController` picking + Y-axis projection** to use
   `geomService.worldAABB` / `meshOrigin` (lines 1697-1711 and
   1780-1784). This is the single largest residual ad-hoc AABB
   computation in the file and contradicts the SOT premise.
2. **Add missing `useEffect` / `useMemo` / `useCallback` deps**:
   `geomService` in `MoveController`'s effect (1872), `catalogService`
   in `tileableObjects` (415) and `snapForAdd` (450).
3. **Add an implementation note** under `tasks/` covering: which
   consumers migrated in Step 4, which deliberately did not
   (`moveOccupancy.ts`, `dropToSurface.ts`, the `MoveController`
   picking math), and why (Step 5/6 boundary). Include the
   centered-AABB vs lower-left occupancy mismatch as a known issue
   so it doesn't surprise the next implementer.
4. **Drop dead `VoxelVec3` import** at line 29 of
   `SceneEditorCanvas.tsx`. Drop `voxelSize` prop from
   `SelectionOutline` and the accompanying eslint-disable comment.

---

## Implementation Decision Review

| Task | Decisions Documented | Decisions Sound | Flags |
|------|---------------------|----------------|-------|
| Step 4 selection outline migration | Partially (commit message only; no `implementation-notes.md` entry) | Yes | Deferring `MoveController` picking math and `moveOccupancy` rewire to Step 5/6 is sensible scope discipline; deferring is fine if it's tracked, but tracking should live in implementation-notes, not only in the commit message. |

**Decision Assessment**: The implementer's calls were good — pure
function extraction, faithful preservation of unchanged contracts,
clean SOT for the outline. The one process miss is the missing
implementation-notes entry; the missing exhaustive-deps entries are
minor lint hygiene.
