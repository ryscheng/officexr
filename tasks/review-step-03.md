# Code Review — Step 3 (commit 2cea83a)

`feat(world/renderer): ObjectInstances + MapColliders use geometry SOT`

## Summary

The commit accomplishes its stated scope cleanly: ObjectInstances and
MapColliders now consume the application layer via
`useApplication().geometry`, the +vs/2 GLTF offset is gone, and
MapColliders' half-extents are derived per-kind from `worldAABB`. Tests
pass (178 world, 180 studio). One Important consistency issue
(BotPhysicsWorld colliders still use the legacy offset/half-extents),
one Important live-edit gap (MapColliders does not re-render on
catalog patches), and a few Minor cleanups. Ship-ready for Step 3
provided the bot-collider gap is tracked.

**Architecture alignment grade: A−.** Renderer is now a clean consumer
of the application layer through context; no module-globals for
geometry math; the +vs/2 convention break is correctly localised.

---

## Plan Compliance

| # | Requirement (from plan §"Critical files" + §"Architectural conventions") | Status | Notes |
|---|---|---|---|
| 1 | `ObjectInstances.tsx`: replace inline math with `geometry.meshOrigin(...)` (or `useInstanceAABB`) | Complete | `geometry.meshOrigin(inst.position, inst.kindId)` at line 325. |
| 2 | `ObjectInstances.tsx`: drop the `+ vs/2` Y offset for GLTF kinds | Complete | The GLTF path has no inline Y offset; the legacy `vy*vs + vs/2` is gone. |
| 3 | `MapColliders.tsx`: position + half-extents from `geometry.worldAABB` | Complete | Lines 43-49 derive `(cx,cy,cz)` and `(hx,hy,hz)` from AABB; fixes the hardcoded `[half,half,half]` bug. |
| 4 | Floor convention: `position[1]*voxelSize` is the AABB bottom, no `+vs/2` | Complete (in geometry-service) | `geometry-service.ts:40` (`by = position[1]*voxelSize; // floor convention — NO +vs/2`); renderer respects it. |
| 5 | Renderer consumes the catalog via the React context (`useCatalog`/`useApplication`), not module-globals | Mostly Complete | `useCatalog()` + `useApplication().geometry` are used. One residual module-global call (`listKinds()` at module top for `useGLTF.preload`) — see Minor #1. |
| 6 | Existing tests pass | Complete | `pnpm --filter @officexr/world test` 178/178; `pnpm --filter @officexr/studio test` 180/180. |
| 7 | No re-introduction of `getKindStride` / `getKind` direct calls in renderer | Complete | `grep` of `packages/world/src/renderer` shows no `getKind`/`getKindStride` usage; only `getKindBoundingDimensions` (a GLTF measurement primitive, unrelated). |

**Compliance score**: 7/7 requirements fully or mostly met.

---

## Issues Found

### Critical

None.

### Important

- **`packages/world/src/physics/rules.ts:64-81` (`worldObjectsToCuboids`)** —
  still emits `position[1]*cs + cs/2` Y center and hardcoded
  `halfExtents = (cs/2, cs/2, cs/2)`. It is consumed by
  `BotPhysicsWorld.syncCubes` (`packages/world/src/bot/BotPhysicsWorld.ts:218`).
  Result after this commit: **the local browser physics
  (`MapColliders`) is correct for multi-voxel kinds, but bots run
  against a separate physics world that still uses the buggy
  half-voxel offset and the wrong half-extents.** A bot will walk
  through a 2 m block while the local player is blocked by it.
  The commit message explicitly defers studio modules to Steps 4-5,
  but `worldObjectsToCuboids` lives under `physics/`, not under any
  studio module, and is the bot's equivalent of `MapColliders`.
  Recommend either (a) migrating `worldObjectsToCuboids` in this
  commit or its immediate follow-up to take `geometry` as a dep and
  use `geometry.worldAABB`, or (b) adding a tracked TODO citing this
  review and the divergence risk.

- **`MapColliders.tsx` does not re-render on catalog patches.** It
  pulls `geometry` from context (stable) and `snapshot` from the
  store, but never subscribes to `api.catalog`. When a user edits
  `kind.dimensions` live via the Object editor (a documented
  workflow — see `task-07`), the visible mesh updates (via
  `useCatalog()` re-render in `ObjectInstancesView`), but the
  collider half-extents stay frozen until the next `worldObjects`
  change. The fix is one line: subscribe to the catalog (e.g. via
  `useCatalogSnapshot`/`useCatalog()` and include its identity in a
  re-render trigger), mirroring how `useInstanceAABB` does it. Not a
  Step 3 regression — the same staleness existed before — but the
  commit message claims "Player collision matches the visible mesh
  exactly", which is only true when the catalog is static.

### Minor

- **`ObjectInstances.tsx:39` — `listKinds()` module-top preload.** The
  preload call still goes through the module-global catalog. This
  is a real DI bypass, though arguably justified because `useGLTF.preload`
  must run before React mounts. If you want a strictly clean DIP
  story, move the preload into an effect inside the
  `<ApplicationProvider>` consumer that calls `api.catalog.listKinds()`.
  Otherwise add a one-line comment naming the constraint (the
  CLAUDE.md SOLID guardrail says "document the reason inline").

- **`ObjectInstances.tsx:339` — stale dep `voxelSize`.** The
  `useEffect` deps `[instances, voxelSize, kind.scale, mat, geometry]`
  list `voxelSize`, but the effect body no longer uses it (positions
  now come from `geometry.meshOrigin`). Harmless — voxelSize is
  effectively constant within a session — but worth removing for
  signal hygiene so the next reader doesn't think the matrix update
  depends on it.

- **`ObjectInstances.tsx:424` — `PrimitiveInstanceGroup` effect deps**
  list `[instances, voxelSize, mat]` but the body also reads
  `inst.position[*]`. `instances` covers that, so it's fine; flagging
  only to confirm the choice was deliberate.

- **`ObjectInstances.tsx:7-9` — leftover `listKinds` + `getCubeKind`
  imports.** Re-exporting `getCubeKind` for back-compat is fine and
  documented; the `listKinds` import is only used by the preload
  loop. Group both imports and document the deprecation more
  visibly, or migrate the preload (see Minor #1).

- **`packages/studio/src/modes/room/SceneEditorCanvas.tsx:961-971` and
  `:1131`** — still apply `+ voxelSize/2` Y offset and assume
  `[half,half,half]` extents for picking and overlay math. Not in
  scope for Step 3 (the commit explicitly defers this to Step 4),
  but listing it here so the Step 4 reviewer can verify it's caught.

- **Comment accuracy check (Mugshot path, `ObjectInstances.tsx:407-417`)**:
  the math (`vy*vs + vs/2` puts BoxGeometry center at vs/2 above
  floor, so the box bottom sits at `vy*vs`) is correct for a
  voxel-sized BoxGeometry. The inline comment is clear and
  distinguishes "BoxGeometry center→bottom conversion" from "legacy
  renderer offset" — exactly the kind of inline SOLID-violation
  justification CLAUDE.md asks for. Good.

---

## What Looks Good

- The diff is small, focused, and reads as a textbook
  "extract-coordinate-math-to-service" refactor. Both files are now
  near-trivial: ObjectInstances does grouping + matrix composition;
  MapColliders does AABB → center+halfExtents. Neither knows the
  convention.
- The Mugshot primitive comment is the right shape — it names the
  reason for the `+vs/2`, distinguishes it from the legacy offset,
  and explains the constraint (center-origin BoxGeometry).
- MapColliders is now ~62 LOC including imports; the bug-prone
  hardcoded half-extents are gone, and the function reads top-to-
  bottom without surprises.
- `useApplication()` is destructured at the top of each component,
  not threaded through props — appropriate use of context as IoC,
  matching the plan's Layer-2 prescription.

---

## Test Coverage

| Area | Tests Exist | Coverage Notes |
|---|---|---|
| Geometry service (worldAABB / meshOrigin / footprint / tileStep) | Yes | Added in Step 1; this commit relies on those. Not re-checked here. |
| ObjectInstances rendering with `geometry.meshOrigin` | Indirect | Existing `room-render-bounds` / e2e marker assertions cover the output shape; no unit test exercising `meshOrigin` from inside the renderer. |
| MapColliders collider extents per kind | No direct unit test | The bug fix is purely declarative ("derive from AABB") so the geometry-service tests transitively cover it, but a regression test exercising MapColliders with a multi-voxel kind would catch a future regression to the `[half,half,half]` shape. |
| Bot physics consistency (`worldObjectsToCuboids`) | No (untouched) | See Important #1 — divergence between bot + local-player physics is not covered. |

**Test Coverage Assessment**: Adequate for this commit's scope.
Worth adding (in Step 4 or 5) a small integration test that
asserts `MapColliders` and `worldObjectsToCuboids` produce the same
descriptors for a given `WorldObjects`, which would have caught the
bot-divergence flagged above.

---

## Test Execution

| Check | Result | Details |
|---|---|---|
| Test command discovered | Yes (`pnpm test` per package via `vitest run`) | Found in `packages/world/package.json` and `packages/studio/package.json`. |
| World test suite | Passed (178/178) | `pnpm --filter @officexr/world test`, ~1.92s. |
| Studio test suite | Passed (180/180) | `pnpm --filter @officexr/studio test`, ~4.05s. |
| TDD evidence in implementation-notes.md | N/A | Step 3 plan doesn't specify TDD mode; commit message states tests still pass and lists counts that match observed output. |

**Test Execution Assessment**: Clean. Counts match the commit
message exactly (178 + 180 = 358), indicating the implementer ran
the same suites locally before committing.

---

## Specific-Check Answers

1. **Inline coordinate math removed?** Yes for the GLTF path
   (`KindInstanceGroup`). The only remaining inline math is in
   `PrimitiveInstanceGroup` (Mugshot diagnostic) where it is
   justified and documented (BoxGeometry center→bottom conversion).
2. **MapColliders pulls position AND half-extents from geometry?** Yes —
   both come from `geometry.worldAABB(...)`. The old
   `[half,half,half]` bug is fixed.
3. **PrimitiveInstanceGroup +vs/2 math correct? Comment clear?** Yes
   and yes. `pos.y = vy*vs + vs/2` puts the center of a
   voxel-sized BoxGeometry at `vs/2` above floor → bottom sits at
   `vy*vs`, matching the floor convention. The inline comment
   correctly distinguishes the center-origin conversion from the
   legacy renderer offset.
4. **Legacy +vs/2 gone from GLTF path? Consistent with floor
   convention? Anywhere else still expects the old offset?**
   Gone from `ObjectInstances`. Consistent with the plan's floor
   convention. **Two places still expect the old offset:**
   (a) `packages/world/src/physics/rules.ts:74`
   (`worldObjectsToCuboids`, used by `BotPhysicsWorld`) — Important.
   (b) `packages/studio/src/modes/room/SceneEditorCanvas.tsx:964`
   and `:1131` (picking + overlay math) — Step 4 scope, flagged.
   No character ground-sensor code reads `+vs/2` directly — ground
   sensors use Rapier's contact list, not hand-computed cube tops,
   so character physics is unaffected.
5. **SOLID compliance — context vs. globals?** Renderer reads
   geometry + catalog through `useApplication()` / `useCatalog()`.
   The only residual global is `listKinds()` at module-top for
   `useGLTF.preload` — see Minor #1.
6. **`useEffect` deps for the new `geometry` dep correct?** Yes for
   `KindInstanceGroup` (`geometry` is stable, including it is
   correct). `voxelSize` is now a dead dep — Minor #2.
7. **Any `getKind` / `getKindStride` globals introduced here?**
   No. `grep -rn 'getKind\|getKindStride' packages/world/src/renderer`
   shows only `getKindBoundingDimensions` (GLTF measurement, unrelated
   and pre-existing).

---

## Implementation Decision Review

| Area | Decision | Sound? | Notes |
|---|---|---|---|
| Keep Mugshot `+vs/2` in PrimitiveInstanceGroup | Yes — geometry-driven, documented inline | Sound | Center-origin BoxGeometry requires the offset; comment correctly distinguishes it from the legacy offset. |
| Defer `worldObjectsToCuboids` migration | Implicit — not mentioned in commit message | Partially sound | Reasonable to keep diff small, but the bot/local divergence should be tracked. Recommend filing as a Step-3.5 task before Step 6 (bake) so visual regression isn't masked by physics divergence. |
| Keep `listKinds()` module preload | Implicit — preload runs before React mounts | Sound | Justified by `useGLTF.preload`'s ordering constraint, but worth a one-line SOLID-violation comment per CLAUDE.md guardrail. |

**Decision Assessment**: Good calls on the in-scope items; one
non-obvious deferral (`worldObjectsToCuboids`) deserves an explicit
follow-up rather than implicit grouping with Step 4.

---

## Recommendations

1. **Before Step 6** — migrate `worldObjectsToCuboids` to consume
   `InstanceGeometryService` (or refactor `BotPhysicsWorld.syncCubes`
   to bypass it). Otherwise visual-regression baselines could pass
   while bot collision is still bugged.
2. **Step 4 task list** — confirm `SceneEditorCanvas.tsx:961,1131`
   are on the migration ticket (the commit message implies they are,
   but verifying belt-and-suspenders).
3. **One-line follow-up** — drop the dead `voxelSize` dep from the
   `KindInstanceGroup` effect; add a brief inline comment to the
   module-top `listKinds()` preload citing the `useGLTF.preload`
   ordering constraint (per CLAUDE.md's "document the reason
   inline" rule).
4. **Optional** — subscribe `MapColliders` to catalog patches so
   live dimension edits propagate to colliders without a
   `worldObjects` change.
