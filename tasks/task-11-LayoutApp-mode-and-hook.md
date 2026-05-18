# Task 11: `useLayoutDocument` hook and `LayoutApp` mode

## Objective
Add a top-level Layout mode to the studio. Clone the Room editor's structure but constrain object placement to `isLayoutObject` kinds and trigger a debounced bake on every doc change.

## Dependencies
- Task 02 (`LayoutDocument` exists).
- Task 04 (storage + endpoints).
- Task 06 (`BakeRegistry`).
- Task 07 (browser bake deps).
- Task 09 (`ObjectPalette.layoutFilter` prop).
- Task 10 (Object editor knows about the field).

## Context Files
- `tasks/shared-context.md`
- `tasks/updated-prd.md`
- `packages/studio/src/modes/room/RoomApp.tsx:25-335` — clone template.
- `packages/studio/src/modes/room/useRoomDocument.ts:248-274` — autosave debounce pattern to mirror.
- `packages/studio/src/modes/room/RoomPicker.tsx` — template for `LayoutPicker`.
- `packages/studio/src/modes/room/SceneEditorCanvas.tsx` — REUSE for the layout canvas; do NOT fork.
- `packages/studio/src/StudioPage.tsx:29-77` — top-level router.
- `packages/studio/src/ui/Header.tsx:11-22` — mode list.
- `packages/world/src/app/bake-registry.ts` — registry API.

## Files to Create
- `packages/studio/src/modes/layout/useLayoutDocument.ts`
- `packages/studio/src/modes/layout/LayoutApp.tsx`
- `packages/studio/src/modes/layout/LayoutPicker.tsx`
- `packages/studio/src/modes/layout/LayoutEditorCanvas.tsx` (or reuse `SceneEditorCanvas` directly — see Requirements)

## Files to Modify
- `packages/studio/src/StudioPage.tsx` — add `studioMode === 'layout' && <LayoutApp />` around lines 69-74.
- `packages/studio/src/ui/Header.tsx` — add `'layout'` to the `StudioMode` union and to `STUDIO_MODES` (lines 11-22) with appropriate label.

## Requirements
1. `useLayoutDocument()` — owns:
   - `doc: LayoutDocument`, `selection: ReadonlySet<string>`, history (undo/redo).
   - Autosave: 500ms JSON-equality debounce, identical pattern to `useRoomDocument.ts:248-274`. NO useRef-setStateSync mirror pairs.
   - On every doc change (after autosave fires), call `BakeRegistry.scheduleBake(layoutName, doc, deps)` where `deps` come from `createBrowserBakeDeps(catalog)` (Task 07).
   - Mutators (subset of `useRoomDocument`): `placeObject`, `deleteCommand`, `setPositionForCommand`, `loadLayout`, `newLayout`. (Skip `group`/`ungroup` for v1 — layouts don't have groups.)
2. `LayoutApp.tsx`:
   - Same shell structure as `RoomApp.tsx`: `<LeftPanel>` + `<main>` + `<SidePanel>`.
   - LeftPanel: `LayoutPicker` + `ObjectPalette` with `layoutFilter='require'`.
   - Main: reuse `SceneEditorCanvas` (or a small wrapper `LayoutEditorCanvas` that pre-fills layout-specific props). Renders via `<ObjectInstances>` — NO baked GLB rendering here (we're editing).
   - SidePanel: `Toolbar`, `InspectorPanel`, `CommandHistory` — all reused as-is.
   - Add a "Bake status" pill above the toolbar, driven by `BakeRegistry.subscribe`. States: idle / pending / running / settled / error.
3. `LayoutPicker.tsx`: mirror `RoomPicker` for layouts (list `/api/layouts`, new layout, delete layout).
4. `StudioPage.tsx` + `Header.tsx`:
   - Add `'layout'` between `'map'` and `'room'` in the mode list.
   - Hash route: `#layout`.

## Acceptance Criteria
- Navigating to `#layout` shows the new mode.
- Layout view's palette shows only kinds with `isLayoutObject: true`.
- Creating a new layout, placing a few objects, and waiting ~2s produces a baked GLB at `packages/world/baked-layouts/<name>.glb`.
- Navigating away from Layout mid-bake (e.g. clicking Room) does NOT cancel the bake — GLB still lands on disk within ~2s.
- The "Bake status" pill cycles idle → pending → running → settled within the expected timing.
- Existing tests pass; TypeScript compile clean.

## Implementation Notes
- Reuse `SceneEditorCanvas` if it's parametric enough; if it has hard room-specific deps, write a thin `LayoutEditorCanvas` that delegates to the same underlying R3F primitives. Do NOT fork the renderer.
- The "Bake status" pill is a small UI primitive — keep it inline; don't build a generic status-pill library.
- If the `useLayoutDocument` hook gets too close to a verbatim copy of `useRoomDocument`, that's fine — extract shared helpers only if the duplication is purely mechanical AND the extraction doesn't add complexity. SRP says one hook per doc type.
- For the SOLID-violation comment style (per CLAUDE.md), if you find a place that knowingly bends a principle (e.g. mirrored state across two hooks because React's API forces it), leave the principle/why/fix inline comment.
