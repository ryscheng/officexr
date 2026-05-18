# Shared Context — Layout View / Baked-GLTF Optimization

All tasks in this build share the context below. Each task file links back to this and the updated PRD.

## What we're building

A new "Layout" authoring mode that sits alongside Map / Room / Object in the studio. A layout contains only structural geometry (walls / floors / structural pieces). As it's edited it debounce-bakes into a single optimized GLB via `gltf-transform`. Rooms gain an optional `layoutName` reference and load the baked GLB as their base, replacing per-object instancing for the layout subset.

## Hard constraints (from `CLAUDE.md`)

- SOLID is the default. Split layout document, bake service, registry, renderer primitive — single responsibility each.
- `@officexr/sdk` and `@officexr/core-refactor` MUST NOT import `three` or `react`. `LayoutBakeService` in `packages/world/src/app/` must remain headless (no `three`, no `react`, no DOM) so a Node CLI can run it. `gltf-transform` is permitted.
- Editor canvases compose renderer primitives — never fork them. `<LayoutEditorCanvas>` reuses `<ObjectInstances>` for live editing.
- No `useRef + setStateSync` mirror pairs. Use JSON-equality dirty checks like `useRoomDocument`.
- Playwright mugshot tests must run after renderer changes (Task 8, Task 11, Task 12). Re-baseline both ideal PNGs AND the manifest in the same commit if pixels shift.
- When bending a SOLID rule, leave an inline comment naming the principle, the reason, and what would need to change to remove the violation.

## Existing patterns to reuse

- **Storage interface**: `packages/world/src/scenes/storage.ts:32-41` (`SceneStorage`). Mirror with `LayoutStorage`.
- **Filesystem storage**: `packages/world/src/scenes/filesystem-room-storage.ts` is the template for `filesystem-layout-storage.ts`.
- **localStorage**: `packages/world/src/scenes/localstorage-room-storage.ts` is the template.
- **Vite REST endpoints**: `packages/world/vite-plugin-storage.ts:44-56`. Add `/api/layouts` JSON routes + `/api/baked-layouts/:name` binary routes.
- **Serialize / migrate**: `packages/world/src/scenes/serialize.ts:162` (`deserializeScene`), `:281` (`migrateRoomV3toV4`), `:340` (`migrateToV4`).
- **Migration tests**: `packages/world/src/scenes/migration.test.ts`.
- **WorldObjectKind schema**: `packages/world/src/scenes/world-object-kinds-schema.ts:43-103`. `WORLD_OBJECT_KIND_DEFAULTS` near the bottom.
- **Headless bake + CLI**: `packages/world/src/app/bake-service.ts` (browser-callable, headless) and `packages/world/scripts/bake-kind-dimensions.ts` (Node runner). New layout bake follows this same shape.
- **Geometry helpers**: `packages/world/src/renderer/cube-material.ts:56-79` — `extractGeometryFromGltf` / `extractMaterialFromGltf`.
- **Scene root**: `packages/world/src/renderer/Scene.tsx:110-307`. Add new primitives between `<MapColliders>` and `<ObjectInstances>` (lines 205–241).
- **Map colliders**: `packages/world/src/renderer/MapColliders.tsx` — pattern for `<BakedLayoutColliders>` (one static `<RigidBody type="fixed">` with `<CuboidCollider>` children tagged `WALL_GROUPS`).
- **Physics groups**: `packages/world/src/physics/groups.ts` (`WALL_GROUPS`).
- **Studio router**: `packages/studio/src/StudioPage.tsx:29-77` (hash-based, add `studioMode === 'layout' && <LayoutApp />`).
- **Studio header**: `packages/studio/src/ui/Header.tsx:11-22` (`STUDIO_MODES` array + `StudioMode` union — add `'layout'`).
- **Room editor template**: `packages/studio/src/modes/room/RoomApp.tsx:25-335`. `LayoutApp` clones the LeftPanel/main/SidePanel shape.
- **Autosave pattern**: `packages/studio/src/modes/room/useRoomDocument.ts:248-274` (500ms JSON-equality debounce, no useRef-setStateSync).
- **Object Palette filter**: `packages/studio/src/modes/room/ObjectPalette.tsx:103` — `groupByCategory(filterByName(allKinds, deferredQuery), ['character'])`.
- **Object editor**: `packages/studio/src/modes/object/ObjectKindEditorPanel.tsx:42-209` — sections (Kind, Dimensions, Material, Tiling, Placement, Optimization).

## Storage / runtime conventions

- Layout JSON files: `packages/world/layouts/<name>.json`.
- Baked GLBs: `packages/world/baked-layouts/<name>.glb`.
- Endpoints (added by Task 4): `GET/PUT/DELETE /api/layouts/:name`, `GET/PUT /api/baked-layouts/:name` (binary).
- Bake debounce: ~1500ms after last edit (longer than the 500ms doc save).
- `BakeRegistry` is a module-level singleton — bake state survives `LayoutApp` unmounting.

## Out of scope for this build

- Draco compression of the baked GLB (the bake service should accept a flag but default off; revisit once mugshots are stable).
- Web Worker offloading of the bake (the registry uses async/await on the main thread; if perf demands it later, swap implementation behind the same registry API).
- Multi-layout-per-room (one layout per room, per the PRD).
- Authoring layout via the Map view directly (only Layout mode authors; Room and Map are consumers).
