# Task 12: Room and Map views consume baked layouts

## Objective
Wire `RoomDocument.layoutName` into the Room and Map viewports so the baked GLB is rendered as the room's base. Add a layout-picker field to the Inspector. Map view aggregates per `RoomInstance`. After the wiring, re-run Playwright mugshot tests and re-baseline as needed.

## Dependencies
- Task 03 (RoomDocument has `layoutName`).
- Task 08 (`<BakedLayout>` and `<BakedLayoutColliders>` primitives + Scene props).
- Task 11 (Layout mode exists so baked GLBs get created).

## Context Files
- `tasks/shared-context.md`
- `tasks/updated-prd.md`
- `packages/studio/src/modes/room/RoomApp.tsx` — the room shell.
- `packages/studio/src/modes/room/useRoomDocument.ts` — owns the room doc; prefetch hook lives here.
- `packages/studio/src/modes/room/SceneEditorCanvas.tsx` — invokes `<Scene>`; pass `bakedLayoutPath` / `bakedLayoutName` through.
- `packages/studio/src/modes/room/InspectorPanel.tsx` — add "Layout" field.
- `packages/studio/src/modes/map/MapApp.tsx` and `useMapDocument.ts` — aggregate room instances.
- `packages/world/src/renderer/Scene.tsx` — props added in Task 8.
- `packages/world/src/app/bake-registry.ts` — `awaitFresh`, `getVersion`.

## Files to Modify
- `packages/studio/src/modes/room/RoomApp.tsx` — derive `bakedLayoutPath` from `doc.layoutName` and pass to `SceneEditorCanvas`.
- `packages/studio/src/modes/room/SceneEditorCanvas.tsx` — accept new optional props and pass through to `<Scene>`.
- `packages/studio/src/modes/room/InspectorPanel.tsx` — add a "Layout" autocomplete field (datalist or dropdown) populated from `GET /api/layouts`. Empty value = no layout.
- `packages/studio/src/modes/room/useRoomDocument.ts` — on `loadRoom` or `layoutName` change, fire-and-forget `BakeRegistry.awaitFresh(layoutName)` to prefetch.
- `packages/studio/src/modes/map/useMapDocument.ts` and / or `MapApp.tsx` — for each `RoomInstance`, look up the room doc (already done via `useMapRoomLibrary`), derive its `layoutName`, and ensure the rendered scene composes the baked GLB per instance.

## Requirements
1. `RoomApp.tsx`:
   - If `doc.layoutName`, compute `bakedLayoutPath = '/api/baked-layouts/' + encodeURIComponent(doc.layoutName)` and pass `bakedLayoutPath` + `bakedLayoutName` props down.
2. `SceneEditorCanvas.tsx`:
   - Accept optional `bakedLayoutPath?: string` and `bakedLayoutName?: string`. Forward to `<Scene>`. No other behavior change.
3. `InspectorPanel.tsx`:
   - Add a "Layout" field with `<datalist>` populated from `GET /api/layouts`. Bind to `doc.layoutName` via the room doc's mutator. Empty = unset.
4. `useRoomDocument.ts`:
   - When `loadRoom` succeeds and the doc has `layoutName`, call `BakeRegistry.awaitFresh(layoutName, deps, docFetcher)` (best-effort; failures don't block room load).
   - When `layoutName` changes, fire the same prefetch.
5. Map view:
   - `useMapDocument` already lazy-loads rooms referenced by the map. For each `RoomInstance`, derive its `layoutName` (the rooms are already in memory). Map view's canvas renders rooms as bounding boxes today; if Map view does NOT render full geometry today, leave that as-is and skip the GLB composition for Map. If Map view DOES render geometry (check `MapEditorCanvas.tsx`), add the same baked-GLB composition per room instance, positioned/rotated by the `RoomInstance`'s `position`/`rotationY`.
6. Run Playwright mugshot tests. If any baselines shift due to the renderer change in Task 8, re-baseline in the SAME commit by updating both the ideal PNGs and the manifest (per CLAUDE.md). Document in implementation notes which baselines moved and why.

## Acceptance Criteria
- A room with `layoutName` set shows the baked GLB as its base.
- The Inspector "Layout" field autocompletes from `/api/layouts` and persists the selection.
- Switching `layoutName` swaps the baked GLB without a full page reload.
- Deleting the GLB on disk and reloading the room triggers the loading fallback then a fresh bake.
- Map view shows the same composite per room instance (if Map view renders geometry today; otherwise it stays as-is and you note that).
- Playwright mugshot suite is green (re-baselined where appropriate, in this commit, per CLAUDE.md).
- `pnpm -C packages/studio build` and `test` are green.

## Implementation Notes
- Be precise about whether Map view currently renders full geometry. If it does NOT (it shows bounding boxes / abstract markers today per the exploration), do not add full GLB rendering to Map view in this task — that's a separate scope. Just ensure the room data is wired so future Map enhancements can compose it.
- Do not silently widen mugshot diff thresholds. If baselines shift, update them properly.
- The InspectorPanel autocomplete: a `<select>` or `<input list="...">` with `<datalist>` is fine. Don't pull in a new combobox library.
