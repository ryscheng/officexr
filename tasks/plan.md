# Studio Restructure — Multi-Editor Authoring App

## Context

`@officexr/studio` today has three modes managed by `useState<StudioMode>` in `packages/studio/src/StudioPage.tsx`: **Scenes** (CAD-like cube editor), **Characters** (character previewer), **Debug** (multiplayer playtest). The current Scenes editor is too CAD-heavy for authors; there is no way to compose multiple "rooms" into a larger world; non-cube props (furniture, restaurant, prototype kit) aren't supported; and Debug has no way to switch between authored worlds.

We're restructuring the studio into **five purpose-built editors** so each authoring task has its own surface:

- **Map Editor** — compose rooms into a world (positions, rotations, spawn points, sky/stars/HDRI).
- **Room Editor** — point-and-click cube/prop placement with Select / Add / Delete / Tile tools, ghost previews, snapping, multi-select, and groups. Replaces the existing Scenes mode.
- **Object Editor** — view + tune every non-character model (label, swatch, walkable, scale, tint, opacity, roughness, metalness, emissive). The catalog moves from hardcoded `CUBE_KINDS` to an editable JSON file.
- **Character Editor** — unchanged except renamed and re-routed.
- **Debug Mode** — adds a Leva map-picker + "Reset & respawn" button so we can flip between authored maps and reset the fake game state.

The Map Editor also gets sun + R3F-drei Sky + Stars + HDRI loader support. Three additional KayKit asset packs (Furniture, Prototype, Restaurant) are downloaded and registered as non-cube props in the catalog so the Room Editor has real content to work with.

The goal is for an author to: tune cube + prop appearance in Object → build reusable rooms in Room → compose them into a Map with a sky and spawn points → playtest in Debug with bots respawning at the markers.

## Architectural decisions (locked)

These are decided up front so we don't bikeshed during implementation:

1. **Data model**: Existing `SceneDocument` is renamed `RoomDocument` and bumped to `schemaVersion: 3`. A new `MapDocumentV1` references rooms by name with per-instance `position` (voxel coords) + `rotationY: 0|1|2|3` + spawn points (continuous world coords) + environment (sun/sky/stars/HDRI). `spawnPoints` is removed from `RoomDocument`.
2. **Routing**: No `react-router-dom`. Keep `useState<StudioMode>` + `<Header>` tabs (5 of them). Sync to `location.hash` for shareable URLs.
3. **Folder rename**: `packages/world/src/scenes/` → `packages/world/src/worlds/`. `packages/studio/src/modes/scenes/` → `packages/studio/src/modes/room/`. `packages/studio/src/modes/characters/` → `packages/studio/src/modes/character/`. The old `packages/world/scenes/*.json` becomes `packages/world/rooms/*.json` via a one-shot migration script; legacy files are migrated to v3 in place at rename time.
4. **Storage**: Generalize the existing Vite middleware into a `studioStoragePlugin()` that mounts `/api/rooms/:name`, `/api/maps/:name`, `/api/cube-kinds`. Reuse the existing slug-validation + size-cap logic from `packages/world/vite-plugin-scene-storage.ts`.
5. **Cube catalog**: Hardcoded `CUBE_KINDS` (in `packages/world/src/scenes/cube-kinds.ts:32-117`) moves to `packages/world/cube-kinds.json`. The schema gets `scale`, `tint`, `opacity`, `roughness`, `metalness`, `emissive`, `emissiveIntensity`, `category` (block | furniture | prototype | restaurant). A bundled-default JSON ships as a fallback. The renderer subscribes to a `useCubeCatalog` hook and clones the GLTF material per kind to apply overrides.
6. **Asset packs**: Three KayKit packs (Furniture, Prototype, Restaurant) downloaded by a script, unzipped into `packages/studio/public/models/<pack>/`, then seeded into `cube-kinds.json` with sensible defaults.
7. **Groups**: First-class on `RoomDocument` (`groups: Record<groupId, RoomGroup>`). No nesting in v1. `compileScene` is unchanged — groups are a selection/lifecycle concern, not a rendering concern.
8. **Tile tool**: Produces many `placeCube` commands wrapped in one group (not a new `tile` command). State machine: `idle → placed → x-extruded → z-extruded → (click 4 commits Y) → Select`. Esc commits whatever's real and returns to Select. Y-direction picks voxel delta via raycast against a camera-facing vertical plane through the tile origin.
9. **Ghost rendering**: Parallel `<instancedMesh>` per kind with cloned `transparent: true; opacity: 0.5; depthWrite: false` material. Ghosts on a dedicated raycast layer so the snapper ignores them. Pulse (Delete tool) animates opacity 0.25↔0.75 via `useFrame` on one shared material.
10. **Snapping**: Raycast against (opaque cubes ∪ invisible floor). Cube hit → target voxel = instancePos + faceNormal. Floor hit → `(round(x/cubeSize), 0, round(z/cubeSize))`. First-cube rule falls out for free (only floor is hittable initially).
11. **Selection**: `selection: Set<string>` (sourceCommandIds). Plain click replaces; Ctrl/Cmd+click toggles. Clicking a group member selects the whole group atomically.
12. **Room export**: Stub interface `RoomExporter.exportGLB(doc)` + a disabled "Export GLB" button. No GLTFExporter wiring this branch.
13. **Map rendering at runtime**: `compileMap(map, rooms, cubeSize)` recompiles each `RoomDocument` and offsets cube positions by the map's `RoomInstance.position` (with quarter-turn rotation). Result is one flat `WorldObjects` that drops into the existing SDK via `actions.setWorldObjects`. No new SDK types.
14. **HDRI**: Loaded via drei's `<Environment files={url}>`. Two or three preset URLs in `environment-presets.ts`; the Leva env panel exposes a dropdown. The `{ url, intensity, background }` shape is forward-compatible with future uploads.

## Critical files (modify) and reference paths

- `packages/studio/src/StudioPage.tsx` — 3-mode → 5-mode router + hash sync.
- `packages/studio/src/ui/Header.tsx` — 5 tabs, new labels.
- `packages/studio/vite.config.ts` — swap `sceneStorage()` for the unified `studioStorage()` plugin.
- `packages/world/vite-plugin-scene-storage.ts` → `packages/world/vite-plugin-storage.ts` — generalize to 3 endpoints.
- `packages/world/src/scenes/commands.ts` — rename `SceneDocument` → `RoomDocument`, schema 3, add `groups: Record<string, RoomGroup>`.
- `packages/world/src/scenes/serialize.ts` — add `SerializedRoomV3` + `migrateToV3` (drops spawnPoints/characterConfigs).
- `packages/world/src/renderer/ObjectInstances.tsx` — subscribe to `useCubeCatalog`, clone material, apply per-kind overrides.
- `packages/world/src/scenes/cube-kinds.ts` — reads catalog hook instead of being the source.
- `packages/studio/src/modes/scenes/` → `packages/studio/src/modes/room/` (whole folder + renames).
- `packages/studio/src/modes/characters/` → `packages/studio/src/modes/character/`.

New directories/files:
- `packages/world/rooms/` (migrated from `packages/world/scenes/`).
- `packages/world/maps/` (new, with seed `default.json`).
- `packages/world/cube-kinds.json` + `packages/world/cube-kinds.default.json` (bundled fallback).
- `packages/world/scripts/migrate-scenes-to-rooms.ts` and `packages/world/scripts/download-asset-packs.ts`.
- `packages/studio/src/modes/map/` (full new directory).
- `packages/studio/src/modes/object/` (full new directory).
- `packages/studio/src/modes/room/{useEditorTools,GhostLayer,ContextMenu,roomSnap,useKeyboardShortcuts}.ts(x)`.
- `packages/studio/public/models/{furniture,prototype,restaurant}/` (extracted assets, gitignored or committed depending on size).

## Task plan — 15 discrete tasks

Each task lands as one commit on its own checkpoint: build passes, type-check passes, `pnpm test` passes, manual smoke is documented, code-reviewer is run before moving on. Tasks are ordered so the codebase is shippable at every boundary — early tasks land plumbing without breaking the existing Scenes mode, and the rename to Room happens only after the new infrastructure is in.

### Task 1 — Data schemas + migration script
- Add `RoomDocument` (v3) + `RoomGroup` to `packages/world/src/scenes/commands.ts` (keep `SceneDocument` as a deprecated alias for one task only).
- Add `MapDocumentV1`, `RoomInstance`, `SpawnPoint`, `MapEnvironment` in a new `packages/world/src/scenes/map-document.ts`.
- Add `serializeRoom` / `deserializeRoom` / `migrateToV3` in `packages/world/src/scenes/serialize.ts` (drops `spawnPoints` and `characterConfigs` from v2 inputs).
- Write `packages/world/scripts/migrate-scenes-to-rooms.ts` (one-shot CLI; reads `packages/world/scenes/*.json`, writes `packages/world/rooms/*.json` at v3, deletes `scenes/`).
- Add the seed `packages/world/maps/default.json` (one `RoomInstance` referencing `default-v2`, one spawn at `[0,0,0]`, default env).
- **Tests**: round-trip serialize/deserialize for `RoomDocument` v3 and `MapDocumentV1`; `migrateToV3` drops the right fields; unknown `schemaVersion` rejected.
- **Acceptance**: `pnpm --filter @officexr/world test` green. `pnpm --filter @officexr/world migrate:scenes-to-rooms` runs cleanly and produces `packages/world/rooms/default*.json`.

### Task 2 — Storage layer + Vite middleware unification
- Replace `packages/world/vite-plugin-scene-storage.ts` with `packages/world/vite-plugin-storage.ts` that mounts `/api/rooms/:name`, `/api/maps/:name`, `/api/cube-kinds` using a `makeJsonResourceMiddleware()` helper.
- Add `FilesystemRoomStorage`, `LocalStorageRoomStorage` (renamed from `FilesystemSceneStorage`/`LocalStorageSceneStorage`).
- Add `FilesystemMapStorage`, `LocalStorageMapStorage` (mirror of room storage).
- Add `FilesystemCatalogStorage` (single-document GET/PUT against `/api/cube-kinds`).
- Update `packages/studio/vite.config.ts` to use the unified plugin.
- Keep the deprecated `SceneStorage` alias so the existing Scenes mode still compiles this task (it gets retired in Task 6).
- **Tests**: a tiny in-memory storage test that exercises GET/PUT/DELETE round-trips for each resource type (mock fetch).
- **Acceptance**: `pnpm dev` boots; existing Scenes mode still loads/saves via `/api/rooms` (back-compat alias); manual GET to `/api/maps` returns the seed map.

### Task 3 — CubeKind catalog moves to JSON + ObjectInstances reads from catalog hook
- Add `CubeKindEntry` / `CubeKindCatalogV1` schema in `packages/world/src/scenes/cube-kinds-schema.ts` with the extended fields (`scale`, `tint`, `opacity`, `roughness`, `metalness`, `emissive`, `emissiveIntensity`, `category`).
- Add `packages/world/cube-kinds.json` (seeded by hand from the 12 entries in current `cube-kinds.ts:32-117`, all override fields at "no-change" defaults, `category: 'block'`).
- Commit a copy as `packages/world/cube-kinds.default.json` for the bundled fallback (imported via Vite `?json` import).
- Add `packages/world/src/scenes/cube-catalog.ts` — singleton store hook with `get` / `list` / `subscribe` / `replace`; bootstraps via `fetch('/api/cube-kinds')` with fallback to the bundled default.
- Refactor `packages/world/src/scenes/cube-kinds.ts` to re-export `CUBE_KINDS` from the catalog hook so callers don't break.
- Modify `packages/world/src/renderer/ObjectInstances.tsx` to subscribe to the catalog: clone the GLTF material once per kind, apply tint/opacity/roughness/metalness/emissive, multiply instance-matrix scale by `kind.scale` (replaces the hardcoded 1.05).
- **Tests**: catalog round-trip serialize/deserialize; subscriber fires on `replace`; material-override fields survive the round-trip.
- **Acceptance**: Debug mode still renders the existing default scene visually identical; manual edit of `cube-kinds.json` (set blue block's `tint: "#ff00ff"`) → reload → blocks render magenta.

### Task 4 — Download + register the three KayKit asset packs
- Add `packages/world/scripts/download-asset-packs.ts`: downloads and unzips
  - `https://pub-5c607701fd464418972bca5504147874.r2.dev/KayKit_Furniture_Bits_1.0_FREE.zip`
  - `https://pub-5c607701fd464418972bca5504147874.r2.dev/KayKit_Prototype_Bits_1.1_FREE.zip`
  - `https://pub-5c607701fd464418972bca5504147874.r2.dev/KayKit_Restaurant_Bits_1.0_FREE.zip`
  - Targets `packages/studio/public/models/furniture/`, `.../prototype/`, `.../restaurant/`.
- Decide gitignore vs commit based on extracted size — for >5 MB total, add to `.gitignore` and document the `pnpm asset-packs:install` script in `AGENTS.md`. (Default: gitignore; ship the script.)
- Enumerate each pack's `.gltf` files and append entries to `cube-kinds.json` with: id (slugified), label, gltfPath, swatch (a neutral hex), `walkable: false`, default overrides, and `category: 'furniture' | 'prototype' | 'restaurant'`.
- **Tests**: the enumeration step is data-only; add a `cube-kinds.json` shape test that confirms every entry has the required fields and a `category` from the allowed set.
- **Acceptance**: `pnpm asset-packs:install` succeeds, populates the public dir, regenerates `cube-kinds.json`. After restart, ObjectInstances renders the new kinds correctly if they're referenced (manual sanity placement in current Scenes mode).

### Task 5 — Header + 5-mode routing + page shells (no editor logic yet)
- Update `packages/studio/src/ui/Header.tsx` to expose 5 tabs: Map / Room / Object / Character / Debug, with `STUDIO_MODES` array.
- Update `packages/studio/src/StudioPage.tsx` to mount one of five Apps based on `useState<StudioMode>` + `location.hash` sync (`#map`, `#room`, etc.). Default landing: `#map`.
- Rename `packages/studio/src/modes/scenes/` → `packages/studio/src/modes/room/` (filenames + exports updated, but content kept identical for now — `ScenesApp.tsx` → `RoomApp.tsx`, etc.). The Room editor at this checkpoint is the exact old Scenes editor, just at a new route.
- Rename `packages/studio/src/modes/characters/` → `packages/studio/src/modes/character/` (filenames + exports updated; content unchanged).
- Add empty shells for the new modes:
  - `packages/studio/src/modes/map/MapApp.tsx` — three-pane skeleton with a "Map editor — coming next task" placeholder.
  - `packages/studio/src/modes/object/ObjectApp.tsx` — three-pane skeleton with a "Object editor — coming next task" placeholder.
- **Tests**: a shallow render test that mounts `StudioPage`, asserts the active tab matches the hash, and that switching tabs swaps the app.
- **Acceptance**: All five tabs visible; Map and Object show placeholders; Room (= old Scenes) and Character work exactly as before; Debug unchanged. `#map`, `#room`, etc. URL-share works.

### Task 6 — Room editor: multi-select selection state + group document model
- Promote `selection` in `useRoomDocument` (renamed from `useSceneDocument`) from `string | null` to `Set<string>`. Update all call sites.
- Add `groups: Record<string, RoomGroup>` to the in-memory `RoomDocument`; wire `groupCommands`, `ungroupCommands`, `groupOf`, `deleteSelection` mutators.
- Add `commandToGroup` and `groupMembers` derived indexes (memoized).
- Adapt `useRoomInspector` to handle the multi-select case: when selection > 1, render a small "Multi-selection (N)" Leva panel with a Delete button; single selection uses the existing schema.
- Click semantics in `RoomEditorCanvas` (still using the old Select/Add tools at this checkpoint): plain click replaces selection; Ctrl/Cmd+click toggles; clicking any group member selects the whole group.
- Retire the deprecated `SceneStorage` alias from Task 2.
- **Tests**: selection toggling; group create/delete/ungroup; `deleteSelection` removes group members atomically; document save/load preserves `groups`.
- **Acceptance**: With the Room editor open, user can Ctrl+click multiple cubes, see them highlighted yellow in concert; document persists groups across reloads.

### Task 7 — Room editor: Ghost layer + snapping refactor
- Add `packages/studio/src/modes/room/GhostLayer.tsx` — parallel `<instancedMesh>` per kind for solid + pulse ghosts; cloned transparent material; tagged on a dedicated raycast layer.
- Add `packages/studio/src/modes/room/PulseDriver.tsx` — `useFrame`-driven opacity animation for the pulse material; only mounted when ≥1 pulse ghost exists.
- Add `packages/studio/src/modes/room/roomSnap.ts` — `snapToTarget(raycaster, pickables, cubeSize)` that raycasts against (opaque InstancedMesh layer ∪ FloorPicker). Cube hit → `instance.position + faceNormal`; floor hit → grid snap on y=0.
- Refactor the existing Add tool to use `roomSnap` instead of the floor-only `Math.round` so adding a new cube on top of an existing one works.
- The Add tool gains its solid ghost preview via `GhostLayer` (no behavior change otherwise).
- **Tests**: `roomSnap` returns the expected voxel for floor hits and cube-face hits with various normals; ghost meshes ignore the snap raycaster.
- **Acceptance**: Add tool shows a 50%-transparent ghost cube at the snap target; ghost moves smoothly under the cursor; clicking commits at the same voxel.

### Task 8 — Room editor: tool state machine + Delete tool
- Add `packages/studio/src/modes/room/tools.ts` (rewritten): `ToolKind = 'select' | 'add' | 'delete' | 'tile'`, plus `ToolState` discriminated union with `TileSubstate` (still unused this task).
- Add `packages/studio/src/modes/room/useEditorTools.ts` — reducer that owns `ToolState`, computes `ghosts: GhostSpec[]`, and emits mutation intents on click/hover/esc.
- Add `packages/studio/src/modes/room/useKeyboardShortcuts.ts` — single `window.keydown` listener with typing-gate. Map: `Escape → setTool('select')`, `V → select`, `B → add`, `X → delete`, `Delete/Backspace → deleteSelection()`, `Ctrl/Cmd+G → group selection`, `Ctrl/Cmd+Shift+G → ungroup`.
- Update `Toolbar.tsx` to expose Select / Add / Delete / Tile (Tile remains disabled this task).
- Implement the Delete tool: on hover-cube, emit pulse ghosts for the hovered command (or its whole group if grouped); on click, `deleteSelection` after promoting hover to selection.
- **Tests**: reducer transitions for `select → add → select → delete`; Esc returns to select; Delete-hover over a group member produces N pulse ghosts where N = group size.
- **Acceptance**: Delete tool shows a pulsing 25–75% transparent overlay for the hovered cube or group; click deletes. Esc returns to Select. Keyboard shortcuts work outside Leva.

### Task 9 — Room editor: Tile tool (full state machine)
- Extend `useEditorTools.ts` reducer to handle Tile state machine: `idle → placed → x-extruded → z-extruded → (click 4 commits Y) → Select`. Esc commits-real-and-exits at any stage.
- Mouse-to-voxel: X and Z direction project against the y=origin floor plane; Y direction projects against a camera-facing vertical plane through the tile origin (normal = `(camera.position - origin)` flattened to floor).
- Each click promotes the current `ghosts` to real `placeCube` commands via a new `useRoomDocument.placeMany(positions, kindId, groupId)` mutator; lazily creates a group on click 2.
- Collision with an existing cube at a target voxel: overwrite silently (matches the existing `compileScene` `byVoxel` last-wins rule at `compile.ts:42-50`).
- Toolbar's stage hint line shows the live substate (`idle`, `placed`, `x-extruded`, `z-extruded`).
- **Tests**: reducer click 1→4 transitions; group is created at click 2 and grown by clicks 3 + 4; Esc at each stage leaves the right number of real cubes; X/Z/Y count derivation given mock mouse positions.
- **Acceptance**: With a cube kind staged, Tile click 1 places, mouse → X ghosts, click 2 → X row real + Z ghosts, mouse → Z grid grows in 3,6,9,12 cadence (per spec example), click 3 → grid real + Y ghosts, click 4 commits Y and returns to Select.

### Task 10 — Room editor: context menu + group/ungroup polish
- Add `packages/studio/src/modes/room/ContextMenu.tsx` — React portal at right-click screen coords. Items shown by rule:
  - "Group" if 2+ selected and none are grouped.
  - "Ungroup" if selection is exactly a group's membership.
  - "Delete" always when selection non-empty.
- Wire the canvas's `contextmenu` event: suppress browser default; only open menu if right-press did not drag (reuse the existing `drag.current.moved` flag from `SceneEditorCanvas.tsx:121-156`).
- Menu auto-closes on outside click, Esc, item activation.
- **Tests**: rule evaluation for menu item visibility under each selection shape; portal mounts and dismisses correctly.
- **Acceptance**: Right-click on selection shows menu; Group bundles selected commands; Ungroup restores them; Delete removes the lot. Right-drag still rotates the camera (no menu shown).

### Task 11 — Object Editor
- Build `packages/studio/src/modes/object/`:
  - `ObjectApp.tsx` — three-pane layout (KindList | ObjectPreviewCanvas | Leva).
  - `KindList.tsx` — left panel list of kinds grouped by `category` (block / furniture / prototype / restaurant), with swatch chip + label + walkable icon.
  - `ObjectPreviewCanvas.tsx` — minimal R3F canvas with EndlessGrid + single rotating instance of the selected kind.
  - `KindEditor.ts` — Leva controls: label, swatch, walkable, scale, tint, opacity, roughness, metalness, emissive, emissiveIntensity.
  - `useCubeCatalog.ts` (studio-side wrapper around the world-side catalog store) — exposes `selectedKindId`, `setKind`, `patchKind(id, partial)`. Writes auto-save via `FilesystemCatalogStorage` with 500ms debounce.
- Subscribed renderers (`ObjectInstances`, Room editor's `ObjectPalette`, `CubesLayer`) automatically pick up edits — already wired in Task 3.
- **Tests**: catalog mutators produce expected diffs; PUT debounce coalesces rapid edits.
- **Acceptance**: Editing blue block's tint to magenta in Object Editor → switch to Room Editor → palette swatch and any placed instances render magenta. Edits persist across reload.

### Task 12 — Map Editor: data model + canvas + room placement
- Build `packages/studio/src/modes/map/`:
  - `MapDocStore.ts` — `useMapDocument` hook mirroring `useRoomDocument` (load/save/auto-save, `addRoom`, `removeRoom`, `setRoomPosition`, `setRoomRotation`, selection shape `{kind:'room', id} | {kind:'spawn', id} | null`).
  - `MapEditorCanvas.tsx` — R3F canvas with FreeFlyCamera. Each `RoomInstance` is rendered as a translated `<group>` containing a stripped-down `<ObjectInstances>` (instances passed as a prop, no Store subscription). An invisible AABB picker wraps each group so the user can click anywhere on the room to select it.
  - `RoomPalette.tsx` — left panel listing saved rooms (from `/api/rooms`); click → `addRoom` at the camera focus.
  - `RoomInstanceList.tsx` — right panel listing placed room instances with delete + rotate (90° step) buttons.
  - `compile-map.ts` — `compileMap(map, rooms, cubeSize) => WorldObjects` that compiles each room and applies the instance position + quarter-turn rotation; namespaces ids with `<roomInstanceId>/<cubeId>`.
- Selected room shows a translucent yellow outline + `<TransformControls mode="translate">` from drei, snapping to integer voxels in `onChange`.
- **Tests**: `compileMap` correctness — single room at origin equals `compileScene(room)`; two instances at offsets produce duplicated cubes; `rotationY=1` rotates voxel positions around the room-local origin; missing room ref logs a warning and contributes zero instances.
- **Acceptance**: Author can open the seed `default` map, see the existing room at origin, drag it east 10 voxels, add a second instance of the same room, and the map autosaves to `packages/world/maps/default.json` with the new positions.

### Task 13 — Map Editor: environment (sun, sky, stars, HDRI)
- Promote sun direction/color/intensity from local Leva state (`LightingPanel.ts:36-39`) to `MapEnvironment.sun` on the map document.
- Add Sky support via `<Sky>` from drei (turbidity, rayleigh, inclination, azimuth) — controlled by Leva, persisted to `environment.sky` (null when disabled).
- Add Stars via `<Stars>` from drei — Leva-controlled, persisted to `environment.stars`.
- Add HDRI support via drei `<Environment files={url}>` — `environment-presets.ts` ships two or three preset URLs; Leva exposes a dropdown + intensity + "use as background" toggle.
- All four sections are persisted to the map document and applied live in `MapEditorCanvas`.
- **Tests**: `MapEnvironment` round-trip with `sky=null`, `stars=null`, `hdri=null` and with each populated; preset URLs are valid strings.
- **Acceptance**: Author can flip Sky on, drag the sun azimuth, enable Stars, switch HDRI preset; the canvas updates live; reload restores all settings.

### Task 14 — Map Editor: spawn points + Debug Mode map picker
- Extend `Toolbar.tsx` in the Map editor with an "Add spawn" tool. Click on the floor places a visible `<SpawnMarker>` (a low cone or flag mesh) at the continuous world position.
- Add `SpawnList.tsx` — right panel listing spawn points with rename + delete; clicking selects (highlights the marker).
- In Debug mode, add `packages/studio/src/modes/debug/useMapPicker.ts`:
  - Leva `Map` panel with a `name` dropdown populated from `/api/maps`, a "Reset & respawn" button, and a "Reload" button.
  - On selection change or reset: load the map document, `compileMap(...)` → `actions.setWorldObjects(...)`, derive `WorldMap` walls from the compiled cubes and call `actions.setWorldMap(...)`, then if respawn: pick a random spawn and call `actions.setSelfPosition(...)` + `bots.respawnAll(spawns)`.
- Add `BotPool.respawnAll(spawns: SpawnPoint[])` in `packages/world/src/bot/BotPool.ts`: cycle through spawns modulo bot count, calling each bot's `setPosition`. Fallback to origin if no spawns.
- Persist last-selected map in `localStorage` as `officexr:studio:lastMap`.
- **Tests**: `useMapPicker` hook tests against a fake storage + fake actions; `BotPool.respawnAll` distributes positions correctly with N bots and M spawns where N≠M.
- **Acceptance**: In Map editor, add two spawn points, save. Switch to Debug, Map dropdown contains the map, select it → world renders both room instances + spawns, local player teleports to a spawn marker, click "Reset & respawn" → all bots warp to spawn positions.

### Task 15 — Room export stub + final polish + verification
- Add `packages/studio/src/modes/room/export-room.ts` with `RoomExporter` interface and `StubRoomExporter` (throws). Wire a disabled "Export GLB" button into `RoomApp.tsx`'s toolbar.
- End-to-end manual verification (documented in `AGENTS.md` or a new `STUDIO.md`):
  1. `pnpm --filter @officexr/studio dev` opens on `#map`.
  2. Object editor: tint blue block magenta → saved to `cube-kinds.json`.
  3. Room editor: open migrated `default-v2`; use Tile tool to place a 3×2×2 block. Save.
  4. Map editor: create `town`, drop two `default-v2` rooms, add two spawn points (one labeled `front-door`), turn on Sky + Stars + HDRI preset. Save.
  5. Debug: pick `town` from the Map dropdown → world renders with both rooms, magenta tint, sky/stars; player + bots spawn at markers; Reset & respawn re-warps everyone.
- Update `AGENTS.md` with the new mode list, the asset-pack install script, and the new file layout.
- Run `pnpm build` and `pnpm test` from the repo root; address any lint/type drift.
- **Acceptance**: Full smoke flow passes; all unit tests green; build succeeds; code-reviewer report has no Critical issues.

## Verification

End-to-end manual test (as enumerated in Task 15) is the source-of-truth verification. In addition:

- `pnpm --filter @officexr/world test` — runs serialize/migrate/compile-map/catalog tests added in Tasks 1, 2, 3, 12.
- `pnpm --filter @officexr/studio test` — runs reducer/selection/snap/mappicker tests added in Tasks 6, 7, 8, 9, 14.
- `pnpm build` from the repo root — must succeed.
- A lint pass over the new dirs (catches missed import path updates from the folder renames in Task 5).

## Open trade-offs flagged

These are decided but worth confirming after the first few tasks land:

1. **Quarter-turn-only `rotationY: 0|1|2|3`** for `RoomInstance` keeps voxel collision intact. If continuous yaw is desired, that's a bigger physics change — flagged.
2. **Tile-tool collision** silently overwrites (matches `compileScene`'s last-wins rule). Alternative: red-tint colliding ghosts and block the click. Going with the silent overwrite for now.
3. **End-of-Tile gesture** committed by click 4 (then back to Select). Alternative: only Esc ends. Going with click-to-commit-then-exit because it's consistent with clicks 1–3.
4. **Group click in Select tool** selects the whole group atomically — Ctrl-clicking to remove a single member from a group is not supported in v1. Ungroup first if granular edits are needed.
5. **Catalog edits don't broadcast over the SDK channel** — every peer fetches `/api/cube-kinds` at startup. A future `world:catalog` NetEvent could close the live-edit cross-tab gap. Out of scope.
6. **KayKit asset packs are gitignored**, installed via `pnpm asset-packs:install`. If repo size is acceptable they can be committed instead — decide after Task 4 size check.
7. **Undo/redo is not in scope.** The Command History panel + per-task commits is the recovery surface.
