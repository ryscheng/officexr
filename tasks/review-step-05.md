# Code Review — Commit 702249a (Step 5: studio onto Application API)

## Verdict

**Approve with one follow-up.** The four files named in the commit are
cleanly migrated and the architectural intent of the plan is honored.
One studio file outside the named scope (`ObjectPalette.tsx`) still
imports a deprecated module-global, which contradicts the commit
message's "all remaining catalog/compile callers" framing. Tests pass
(178 world + 179 studio).

**Architecture grade: A−.**

The grade is held back from A by (a) the missed `ObjectPalette.tsx`
caller, and (b) one stale comment in `MapEditorCanvas.tsx` that
describes the new bounds as "Local-space AABB" when
`geomService.worldAABB` returns world-frame coordinates.

---

## Plan compliance

| # | Requirement | Status | Notes |
|---|---|---|---|
| 1 | One source of truth for instance geometry | Met (in named files) | `MapEditorCanvas` now derives the per-room selection AABB from `geomService.worldAABB(inst.position, inst.kindId)` instead of `voxelSize/2` half-extents. `useRoomDocument` and `useMapPicker` route through `roomService`, which threads stride from the geometry service. |
| 2 | One source of truth for catalog | Met (in named files) | `useObjectCatalog` reads from `useCatalog()` and `useApplication().catalog` for getCatalog/getKind/patchKind. `useMapPicker` awaits `catalogService.ready()` in place of `bootstrapCatalog()`. |
| 3 | UI consumes via `useApplication()` — no module-globals | **Partial** | The four named files comply. `packages/studio/src/modes/room/ObjectPalette.tsx:3,99` still imports and calls `useObjectKindCatalog` from `@officexr/world/scenes`. Commit message claims this caller was migrated; it was not. |
| 4 | Three layers: Application / UI / Rendering | Met | Studio consumers are pure UI; they only touch `@officexr/world/react` and `@officexr/world/scenes` types. The geometry/room/catalog services live in `@officexr/world/src/app/` and are R3F-free. |
| 5 | Module-globals stay as Step-9 shims | Met | `packages/world/src/scenes/object-kind-catalog.ts` still exports `getKind`, `getKindStride`, `bootstrapCatalog`, `useObjectKindCatalog`, `getCatalog`, `patchKind`; `compileScene` / `compileMap` re-exported from `scenes/index.ts`. No removal — exactly the desired state. |

**Compliance score:** 4/5 fully met, 1 partial.

---

## Specific checks requested

### 1. Direct imports of deprecated module-globals from studio

Grep across `packages/studio/src` for the eight named symbols:

- `useObjectKindCatalog` — **1 hit**:
  `packages/studio/src/modes/room/ObjectPalette.tsx:3` (import) and
  `:99` (call). This is the only real surviving caller; comments and
  doc strings in other files mentioning the old names by name are
  fine.
- `getKindStride`, `bootstrapCatalog`, `compileScene`, `compileMap`,
  `getKind`, `patchKind`, `getCatalog` — **zero hits** outside
  comments / doc references.

### 2. Map editor room-bounds calc via `geomService.worldAABB`

Confirmed at `MapEditorCanvas.tsx:373-379`. Loops over
`compiled.instances`, calls `geomService.worldAABB(inst.position,
inst.kindId)`, unions min/max across all instances. **Per-instance
lookup correctly threads both `position` and `kindId`** — not the
position-only bug the old half-extent math hid.

One nit: the comment at `:360-362` still says "Local-space AABB" /
"converted to world units". The new code returns coordinates already
in the room's own frame (which happens to coincide with world-frame
math because the geometry service does pure `pos * voxelSize` from
voxel zero). The resulting `bounds` are then nested under
`<group position={groupPos}>` (line 423) and re-translated. The math
works (the room-instance coordinate space and the geometry service's
"world" space share an origin until the group transform applies), but
the comment will mislead the next reader. Worth a one-line edit.

### 3. `useObjectCatalog` subscription via the new hook

Confirmed at `useObjectCatalog.ts:39-41`:
```ts
const { catalog: catalogService } = useApplication();
const kinds = useCatalog();
```
`useCatalog` (in `application-context.tsx:89-92`) wraps
`useCatalogSnapshot`, which subscribes via `api.catalog.subscribe` and
returns a fresh `listKinds()` snapshot. Re-renders on `patchKind` are
preserved. `catalogService` ref is added to the relevant `useCallback`
deps (`:101`, `:135`).

### 4. SOLID — DI / test mockability

Preserved. All four files now reach catalog and compile via
`useApplication()`, which is the injected DI seam. Tests can wrap any
component under test in `<ApplicationProvider api={fakeApi}>` with a
hand-rolled `ApplicationApi` — no monkey-patching of module-level
state required. The existing `useRoomDocument` test already runs
green (179/179 studio tests), confirming the indirection didn't break
the harness.

### 5. New module-level singletons / `window` writes

None introduced. Top-level state in the touched files is limited to
string constants (`LAST_MAP_KEY`, `LAST_KIND_KEY`, `LAST_ROOM_KEY`,
`DEFAULT_ROOM_NAME`, `DEFAULT_SPAWN_DROP_HEIGHT`) and an existing
`nextGroupSeq` counter — no behavior change. `window.*` references
in `MapEditorCanvas.tsx` are only `addEventListener` / `removeEvent
Listener` on pointer + key events, which predate this commit.

### 6. Module-globals remain as Step-9 shims

Confirmed. `packages/world/src/scenes/object-kind-catalog.ts` still
defines and exports `getCatalog`, `getKind`, `getKindStride`,
`patchKind`, `bootstrapCatalog`, `useObjectKindCatalog`. The barrel
`packages/world/src/scenes/index.ts` re-exports them. The plan's Step
9 cleanup is correctly deferred.

---

## Issues

### Critical
- None.

### Important
- **`packages/studio/src/modes/room/ObjectPalette.tsx:3,99`**: still
  calls `useObjectKindCatalog` from `@officexr/world/scenes`. Should
  be `useCatalog()` from `@officexr/world/react`. The commit message
  claims this was migrated ("the only callers ... are the back-compat
  re-exports and a handful of non-React node-side scripts"), but this
  is a React caller in studio. Either land a follow-up that flips it,
  or amend the commit message claim. **Recommendation:** follow-up
  commit `feat(studio): migrate ObjectPalette to useCatalog`.

### Minor
- **`packages/studio/src/modes/map/MapEditorCanvas.tsx:360-362`**:
  comment says "Local-space AABB ... computed in voxel space then
  converted to world units" but the new code reads world-frame
  coordinates directly from `geomService.worldAABB(...)`. Rewrite
  to: "AABB in the room's local frame (the geometry service's voxel-
  to-metres math has the same origin as this group)."
- **`packages/studio/src/modes/room/moveOccupancy.ts:40`**,
  **`roomSnap.ts:82`**: doc strings still reference
  `getKindStride(...)` by name. Harmless but will read stale after
  Step 9 deletes the symbol.
- **`useRoomDocument.ts:144-148`**: comment block "Re-compile on every
  doc change. ... <1 ms" lost the perf annotation in the rewrite.
  Nice-to-have to keep that note since it explains why the `useMemo`
  is sufficient.

---

## What looks good

- The `roomService` indirection in `useRoomDocument` cleanly removes
  the `(id) => getKindStride(id, VOXEL_SIZE)` inline thunk from every
  caller — exactly the kind of "consumer no longer assembles
  half-derived parameters" win the plan was after.
- Inside `MapEditorCanvas`, the new bounds calc passes **both**
  `inst.position` and `inst.kindId` to `geomService.worldAABB`. Easy
  thing to get wrong by passing only the position; reviewer-friendly
  that this is unambiguous in the code.
- `useObjectCatalog` correctly adds `catalogService` to `useCallback`
  dep arrays at `:101` and `:135`. Many DI migrations forget this and
  ship stale-closure bugs that only surface when the API instance is
  swapped (e.g. during tests).
- The `useMapPicker` change keeps the "await readiness before
  compiling" intent visible in the comment, even though the mechanism
  shifted from `bootstrapCatalog()` to `catalogService.ready()`.
- No new `window.*`, no new module-level state, no new `import 'three'`
  in studio. DIP boundary intact.

---

## Test execution

| Check | Result | Details |
|---|---|---|
| Test command discovered | Yes | `pnpm --filter @officexr/{studio,world} test`, verified from prior commit message + run |
| `@officexr/studio` test suite | **Passed 179/179** | 17 test files, 8.13s |
| `@officexr/world` test suite | **Passed 178/178** | 20 test files, 3.67s |
| TDD evidence in implementation notes | N/A | This is a migration step; no new behavior to TDD — coverage is held constant by the existing renderer/outline/occupancy suites |

---

## SOLID review

- **SRP:** Touched files each got *smaller* — the inline
  `(id) => getKindStride(id, VOXEL_SIZE)` lambdas and
  `voxelSize/2 ± offset` arithmetic moved into the geometry service
  where they belong. Good.
- **DIP:** All four files now depend on the `ApplicationApi`
  interface, not on concrete imports from `world/scenes`. The
  deprecated shims still exist in `world/scenes` but studio no longer
  reaches into them (with the ObjectPalette exception above).
- **OCP / ISP / LSP:** No relevant surface changed; nothing to flag.

No undocumented SOLID violations introduced.

---

## Recommendations

1. **(Important)** Follow-up commit migrating
   `packages/studio/src/modes/room/ObjectPalette.tsx` to
   `useCatalog()` so the Step 5 invariant ("zero deprecated globals
   in studio") actually holds before Step 9 deletion lands. Without
   this, Step 9 will fail at compile time on a hit nobody expects.
2. **(Minor)** One-line comment correction in `MapEditorCanvas.tsx`
   `:360-362` describing the new bounds frame.
3. **(Minor)** When Step 9 lands, sweep doc strings in
   `moveOccupancy.ts` / `roomSnap.ts` for stale `getKindStride`
   mentions in the same change.
