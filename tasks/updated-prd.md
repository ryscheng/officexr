# PRD — Layout View & Baked-GLTF Map Optimization

## Problem

Today the studio has two top-level authoring modes that produce world geometry: **Map** (composes rooms into a world) and **Room** (places individual objects inside a room). Every object — walls, floors, furniture, props — lives as a per-instance entry in the `RoomDocument` and gets rendered per-frame by `<ObjectInstances>` with one `CuboidCollider` each.

As rooms grow this is the obvious performance cliff: hundreds of structural pieces (walls, floor tiles) re-instanced every frame, hundreds of static colliders in Rapier. Designers can't iterate on structural geometry independently from furnishings, and rebuilds get expensive.

## Goals

1. Split structural geometry from furnishings into a reusable, optimized artifact.
2. Let designers iterate on layouts independently; let rooms become lightweight prop arrangements on top.
3. Keep the existing Room and Map editing UX intact.
4. Preserve physics — players still collide with walls and floors.

## Non-goals

- Draco compression of the GLB (deferred behind a flag, default off).
- Web Worker offloading of the bake (deferred; behind the same registry API if needed).
- Multi-layout-per-room (one layout per room).
- Authoring layouts via Map view (Layout mode is the only authoring entry).

## Concepts

### Layout

A `LayoutDocument` is a thin sibling of `RoomDocument`. Same `SceneCommand[]` shape, but:

- Only kinds with `isLayoutObject: true` may appear in its commands.
- It bakes to an optimized GLB on disk (`packages/world/baked-layouts/<name>.glb`) via `gltf-transform` (`dedup`, `weld`, `prune`, `join`, `flatten`).
- Storage at `packages/world/layouts/<name>.json` with REST endpoints `/api/layouts/...`.

### Layout object marker

`WorldObjectKind` gains `isLayoutObject: boolean` (default `false`). This is set in the Object editor and controls:

- Whether the kind appears in Layout view's Object Palette (only `true`).
- Whether the kind is hidden in Room view's Object Palette by default (yes; toggleable to show all).

### Room → Layout reference

`RoomDocument` gains `layoutName?: string` (schema bump v4 → v5). When set, the room view composes the baked GLB as its base AND continues to render the room's own non-layout commands. Map view, for each `RoomInstance`, resolves the same chain.

### Bake lifecycle

- Edits trigger a 500ms doc autosave (existing) and a 1500ms bake debounce (new, via `BakeRegistry`).
- The registry is a module-level singleton — an in-flight bake survives `LayoutApp` unmounting when the user navigates away.
- Consumers (Room view, Map view) load via `<BakedLayout>`, which calls `BakeRegistry.awaitFresh(layoutName)` when the GLB is missing or stale and shows a fallback until the bake resolves.

## User stories

1. **Author layout kinds.** "As a designer, I open a wall kind in the Object editor, toggle 'Is layout object', and save. The kind now appears in Layout view's palette and is hidden by default in Room view."
2. **Create a layout.** "I switch to Layout mode (`#layout`), create a new layout, and place walls and floors. The status pill shows the bake cycling idle → pending → saving → idle within ~3s of my last edit."
3. **Nav-away mid-bake.** "I make an edit and immediately click Room mode. The bake completes in the background; the GLB lands on disk within ~2s of my navigation."
4. **Compose a room on a layout.** "In Room mode I create a new room, set its 'Layout' field to my saved layout. The baked walls render as the base; the Object Palette hides wall kinds by default. I drop a chair on the baked floor — it lands correctly, doesn't fall through."
5. **Map composes layouts.** "I add my room to a map. Map view shows the same composite — baked walls + chair — at the room instance's position."
6. **Layout still missing.** "If a room references a layout whose GLB has been deleted, the room view shows a loading fallback briefly, then the bake re-runs and the room renders."

## Architecture (summary)

- `packages/world/src/scenes/world-object-kinds-schema.ts` — `isLayoutObject` field.
- `packages/world/src/scenes/layout-document.ts` (NEW) — `LayoutDocumentV1`.
- `packages/world/src/scenes/serialize.ts` — `serializeLayout`, `deserializeLayout`, `migrateRoomV4toV5`.
- `packages/world/src/scenes/commands.ts` — `RoomDocument.schemaVersion: 5`, `layoutName?: string`.
- `packages/world/src/scenes/filesystem-layout-storage.ts` and `localstorage-layout-storage.ts` (NEW).
- `packages/world/vite-plugin-storage.ts` — `/api/layouts/*` and `/api/baked-layouts/*` routes.
- `packages/world/src/app/layout-bake-service.ts` (NEW) — headless bake (no `three`, no `react`).
- `packages/world/src/app/bake-registry.ts` (NEW) — module-level debounce + cross-unmount promise.
- `packages/world/src/app/layout-bake-service-browser.ts` (NEW) — `fetch`-based wrapper.
- `packages/world/scripts/bake-layout.ts` (NEW) — Node CLI.
- `packages/world/src/renderer/BakedLayout.tsx` and `BakedLayoutColliders.tsx` (NEW).
- `packages/world/src/renderer/Scene.tsx` — accepts `bakedLayoutPath?`, `bakedLayoutName?`.
- `packages/studio/src/modes/layout/` (NEW) — `LayoutApp`, `LayoutPicker`, `LayoutEditorCanvas`, `useLayoutDocument`.
- `packages/studio/src/modes/room/ObjectPalette.tsx` — `layoutFilter` prop.
- `packages/studio/src/modes/room/RoomApp.tsx` — default `layoutFilter='exclude'` + toggle, plus `bakedLayoutPath` resolution.
- `packages/studio/src/modes/room/InspectorPanel.tsx` — "Layout" autocomplete field.
- `packages/studio/src/modes/object/ObjectKindEditorPanel.tsx` — `isLayoutObject` checkbox in Placement section.
- `packages/studio/src/StudioPage.tsx` + `ui/Header.tsx` — `'layout'` mode.

## Acceptance summary

- All Playwright mugshot tests pass (with one-time re-baseline allowed for rooms that previously rendered layout-tagged geometry).
- v4 → v5 migration test passes; existing rooms load with `layoutName: undefined`.
- All existing tests stay green.
- The verification flow in `warm-kindling-badger.md` passes end-to-end.
