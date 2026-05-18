# Implementation Notes

## Task 01: Add isLayoutObject to WorldObjectKind
- **Decisions**: Added `isLayoutObject?: boolean` as an optional field on `WorldObjectKind` in `world-object-kinds.ts`. Kept optional to avoid breaking existing catalog entries.
- **Deviations**: None.
- **Trade-offs**: Optional field means no compile-time enforcement that every kind declares its category. Acceptable because the catalog is hand-authored and the UI makes the choice explicit.
- **Risks**: None significant.

## Task 02: Define LayoutDocument type and serialization
- **Decisions**: `LayoutDocument` mirrors `RoomDocument` structurally (`schemaVersion: 1`, `name`, `title?`, `updatedAt?`, `commands: SceneCommand[]`) but with no `groups` field (v1 layouts are flat command lists). Serialization via `serializeLayout` parallels `serializeRoom`.
- **Deviations**: None.
- **Trade-offs**: Deliberate near-copy of RoomDocument (SRP per-doc-type, no premature abstraction).
- **Risks**: If layout schema evolves to need groups, migration tooling will be needed.

## Task 03: RoomDocument v4-to-v5 migration with layoutName
- **Decisions**: `RoomDocument` `schemaVersion` bumped to `5`; added `layoutName?: string`. Migration from v4 leaves `layoutName` undefined. `serializeRoom` round-trips the field. Downgrade path (v5 → v4) strips `layoutName`.
- **Deviations**: None.
- **Trade-offs**: Version bump means any client reading a v5 doc against a v4 schema will silently ignore `layoutName`. Acceptable for the current single-client setup.
- **Risks**: None.

## Task 04: Layout storage and bake routes
- **Decisions**: Vite dev-middleware at `/api/layouts` (GET list, GET/PUT individual) and `/api/baked-layouts` (GET/PUT GLB) wired into `vite.config.ts`. `FilesystemLayoutStorage` for layout JSON persistence.
- **Deviations**: None.
- **Trade-offs**: Dev-only filesystem routes; production would need a real backend.
- **Risks**: `/api/layouts` returns bare string[] which is not typed — acceptable for a dev-only endpoint.

## Task 05: Headless LayoutBakeService using gltf-transform
- **Decisions**: `bakeLayout(doc, kindLookup, gltfLoader, options?)` is zero-dependency on `three`/`react`. Uses `@gltf-transform/core` WebIO + `mergeDocuments`. Source GLB caching by URL prevents redundant fetches within a single bake call.
- **Deviations**: `mergeDocuments` node mapping was non-obvious — used `propMap.get(sourceScene)` to get merged scene counterpart, then called `listChildren()` on it.
- **Trade-offs**: `WebIO` works in both browser and Node; `NodeIO` injection is available for CLI use.
- **Risks**: `@gltf-transform/core` mergeDocuments API may change across versions.

## Task 06: BakeRegistry debounce and cross-unmount promise
- **Decisions**: Module-level singleton with `Map<layoutName, RegistryEntry>`. `scheduleBake` debounces 1500ms. `awaitFresh` is non-async (creates and stores `inFlight` synchronously before any `await`) to prevent concurrent-call race where second call misses the dedup.
- **Deviations**: Added `.catch(() => undefined)` no-op to `inFlight` in both `startBake` and `awaitFresh` to prevent unhandled Promise rejections in tests.
- **Trade-offs**: Module singleton means registry state persists across hot-module-reloads in dev — reset via `_resetRegistry()` in tests.
- **Risks**: If bake fails, `BakeState` = `'error'` and the GLB is not updated. Subsequent `scheduleBake` will retry.

## Task 07: Browser bake wrapper and Node CLI
- **Decisions**: `createBrowserBakeDeps(catalog)` builds a `BakeDeps` with `fetch`-based gltf loader and PUT publisher. Node CLI (`scripts/bake-layout.ts`) resolves `kind.gltfPath` from `/models/...` to `packages/studio/public/...`.
- **Deviations**: `fetch` body type `Uint8Array` caused TypeScript error — fixed with `.buffer.slice(...)` cast to `ArrayBuffer`.
- **Trade-offs**: CLI reads catalog from `world-object-kinds.json`; fallback to `.default.json`. Hard-coded path mapping is fragile if public asset paths change.
- **Risks**: CLI only works from monorepo root; not suitable for standalone invocation.

## Task 08: BakedLayout and BakedLayoutColliders renderer primitives
- **Decisions**: `BakedLayout` subscribes to BakeRegistry for cache-busting via `?v=N` URL suffix. Created separate `LayoutMaterialOverride = (material: THREE.Material) => THREE.Material` since layout meshes have no `kindId` (unlike `ObjectInstances.MaterialOverride` which takes `(kindId, base)`).
- **Deviations**: `compileScene` third arg was not `voxelSize` but `KindStrideLookup` — removed the erroneous argument.
- **Trade-offs**: `BakedLayoutColliders` traverses the GLTF scene graph on every mount; could be memoized if performance is a concern.
- **Risks**: `useGLTF` caches by URL; cache-busting via `?v=N` works but leaves stale cache entries in `useGLTF`'s cache.

## Task 09: ObjectPalette layoutFilter prop and Room view toggle
- **Decisions**: Added `layoutFilter: 'all' | 'exclude' | 'require'` prop to `ObjectPalette`. `'exclude'` (default for Room view) hides `isLayoutObject` kinds; `'require'` (Layout editor) shows only them. Room editor adds "Show layout objects" checkbox defaulting to unchecked.
- **Deviations**: None.
- **Trade-offs**: Session-local toggle (not persisted to localStorage). Acceptable for a dev-facing control.
- **Risks**: None.

## Task 10: Object editor isLayoutObject toggle
- **Decisions**: Added `isLayoutObject` boolean toggle in the Object editor's kind inspector. Persists to `world-object-kinds.json` via the existing kind-update API.
- **Deviations**: None.
- **Trade-offs**: No validation preventing a kind from being both layout and non-layout; relies on author discipline.
- **Risks**: None.

## Task 11: LayoutApp mode and useLayoutDocument hook
- **Decisions**: Simple snapshot-based undo stack (array of `LayoutDocument`) in `useLayoutDocument` since `RoomHistory` is coupled to `RoomDocument`/`EditAction`. `LayoutEditorCanvas` is a thin adapter that converts `LayoutDocument` to a minimal `RoomDocument` shim for `SceneEditorCanvas`. `LayoutApp` includes `BakeStatusPill` showing bake state from `BakeRegistry.subscribe`. Added `'layout'` to `StudioMode` and `STUDIO_MODES` array; updated studio-mode test from 6 to 7 modes. `roomDocCompat` ISP violation documented inline.
- **Deviations**: None.
- **Trade-offs**: ISP violation in `LayoutApp.roomDocCompat` — `InspectorPanel` depends on the full `RoomDoc` interface; shim provides all required fields. Documented with SOLID comment.
- **Risks**: If `useRoomDocument` return type grows, `roomDocCompat` must be updated.

## Task 12: Room and Map views consume baked layouts
- **Decisions**: `useRoomDocument` gains `setLayoutName` (direct `setDoc` mutation, not an `EditAction` — layout link is metadata, not a reversible command). Prefetch `awaitFresh` fires on `doc.layoutName` change and on `setLayoutName`. `InspectorPanel` adds `LayoutSection` shown in all selection branches (empty, multi, placeObject, unknown-op). `MapEditorCanvas` renders `<BakedLayout>` per `RoomInstanceMesh` when `room.layoutName` is set. Map view DOES render full geometry; baked layout GLB is composed per room instance.
- **Deviations**: `layoutName` not added to `EditAction` / `RoomHistory` — metadata-only, undo would be unexpected for a room-geometry-link change.
- **Trade-offs**: `LayoutSection`'s datalist is populated from `GET /api/layouts` on every mount; could be cached at the hook level if the list is large.
- **Risks**: `awaitFresh` prefetch silently no-ops if `/api/layouts/:name` returns 404 (layout not yet baked). Non-blocking.
- **Map view note**: Map view renders full room geometry via `<ObjectInstances>`. `<BakedLayout>` is now also composed per room instance, positioned/rotated by the `RoomInstance`'s group transform (same `position` + `rotationY` as the cubes).
- **Playwright mugshot status**: 8 passed (Barbarian, all angles × 2 modes), 40 skipped (no ideal PNG for other characters — expected). No failures. No baseline drift from this task set (renderer primitives only activate when `layoutName` is set, which is not the case in mugshot fixtures).
