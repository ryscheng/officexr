# Updated PRD — Object Capability Flags, Tiling Axis Control, Snap Redesign, and Grid Migration

**Status:** Codebase-aware rewrite. File paths, schema versions, and implementation constraints derived from discovery-phase codebase audit. Updated to reflect rename refactor (task-00).

---

## Background

The room editor was originally built around KayKit BlockBits — uniformly-sized 2×2×2 cube tiles that all tiled identically along all three axes. Since then, KayKit Furniture, Prototype, and Restaurant asset packs have been added (281 total kinds). Furniture pieces, chairs, tables, and decorative objects should not tile like floor blocks, should snap to existing tileable surfaces, and in some cases should "drop" onto the nearest surface when placed. The tiling tool's fixed X→Z→Y axis order must become per-kind configurable.

The coordinate system also needs to change: the implicit 2 m voxel grid is too coarse for furniture placement. This PR migrates the entire codebase to 0.5 m voxels via a room-document schema version bump.

The codebase also carries legacy "cube" naming (e.g. `CubeKindEntry`, `PlaceCubeCommand`, `CUBE_SIZE`) that is misleading because the system now places generic world objects — not just cubes. Task-00 is a pure rename pass that resolves this naming debt before the capability work begins.

---

## What Already Exists

- `CubeKindEntry` (to be renamed `WorldObjectKind` in task-00) in `packages/world/src/scenes/cube-kinds-schema.ts` — no capability fields yet; `normalizeKind` and `CUBE_KIND_DEFAULTS` are the correct extension points.
- `RoomDocument` at `schemaVersion: 3` in `commands.ts`; serialization in `serialize.ts`; room files in `packages/world/rooms/`.
- `compileScene(doc, cubeSize)` in `compile.ts` — already takes `voxelSize` as a parameter (renamed in task-00); callers pass the hardcoded value `2`.
- `cubeSize = 2` is hardcoded in four places: `config.ts` (`CUBE_SIZE`), `useRoomDocument.ts` (line 150), `MapEditorCanvas.tsx` (local const), `useMapPicker.ts` (local const). All renamed to `VOXEL_SIZE`/`voxelSize` in task-00.
- `snapToVoxel` in `roomSnap.ts` — pure function, well-tested.
- `checkMoveOccupancy` in `moveOccupancy.ts` — occupancy check treating every object as exactly 1 voxel.
- `TileState` machine in `SceneEditorCanvas.tsx` — 4-stage fixed-order X→Z→Y machine.
- `KindEditorPanel.tsx` (renamed `ObjectKindEditorPanel.tsx` in task-00) — fully-controlled panel using in-house `Section`, `Toggle`, `SelectInput`, `NumberInput` controls; no Leva.
- `MapColliders.tsx` — all objects are static `<RigidBody type="fixed">`.
- `ObjectInstances.tsx` — GPU instancing via `THREE.InstancedMesh`, no LOD, no static-batch, no frustum-cull hints.

---

## What Needs To Be Built

### 0. Rename cube-kind identifiers to world-object-kind (task-00)

Pure mechanical rename — no behaviour changes. Identifiers affected:

| Old | New |
|---|---|
| `CubeKindEntry` | `WorldObjectKind` |
| `CUBE_KIND_DEFAULTS` | `WORLD_OBJECT_KIND_DEFAULTS` |
| `PlaceCubeCommand` | `PlaceObjectCommand` |
| `cube-kinds-schema.ts` | `world-object-kinds-schema.ts` |
| `cube-catalog.ts` | `object-kind-catalog.ts` |
| `cube-kinds.json` / `cube-kinds.default.json` | `world-object-kinds.json` / `world-object-kinds.default.json` |
| `/api/cube-kinds` | `/api/world-object-kinds` |
| `CUBE_SIZE` / `cubeSize` | `VOXEL_SIZE` / `voxelSize` |
| `KindEditorPanel.tsx` | `ObjectKindEditorPanel.tsx` |

The `op: 'placeCube'` string in room JSON is left as-is for backward compatibility in task-00. Task-02 migrates it to `op: 'placeObject'` in the v4 schema bump.

### 1. Capability fields on `WorldObjectKind`

Add three new fields:

```ts
/** Which axes this kind can tile along in the tile tool. */
tilingAxes: { x: boolean; y: boolean; z: boolean };

/** If true, snaps down to the nearest surface at placement time (one-shot; becomes static). */
gravity: boolean;

/** Optimization hint for the renderer. 'none' means no change (default).
 * 'static-batch' and 'frustum-cull' are scaffolded but not yet implemented.
 * TODO(ObjectInstances.tsx): wire up when a future PR implements these paths. */
optimization: 'none' | 'static-batch' | 'frustum-cull';
```

**Defaults (applied by `normalizeKind`):**
- `tilingAxes`: `category === 'block'` → `{ x: true, y: true, z: true }`; all other categories → `{ x: false, y: false, z: false }`
- `gravity`: `false` for all existing kinds
- `optimization`: `'none'` for all existing kinds

No changes to `world-object-kinds.json` on disk — defaults are applied at load time via `normalizeKind`.

**OCP note:** The `optimization` enum will fail at compile time if a renderer switch-case is added for new variants without handling the existing ones. This is the intended OCP-safe scaffold.

### 2. Room document migration: v3 → v4 (voxelSize 2 → 0.5 + op rename)

- Bump `RoomDocument.schemaVersion` to `4`.
- Migration: multiply every `placeCube`/`placeObject` command's `position` triple by `4` (so world positions are preserved: `voxel × 0.5 m = same world position as old voxel × 2 m`), and rewrite `op: 'placeCube'` → `op: 'placeObject'`.
- Migration runs on load in `useRoomDocument.ts` (and anywhere else that deserializes a `RoomDocument`).
- Re-save room JSON files on disk in v4 form after migration is confirmed.
- Add `SerializedRoomV4` to `serialize.ts`; update `deserializeScene` to handle `schemaVersion: 4`.

### 3. Replace hardcoded `voxelSize = 2` globally

Replace the four hardcoded sites with the single exported `VOXEL_SIZE` constant (now 0.5) from `packages/world/src/renderer/config.ts`. Verify downstream consumers (physics tests, SDK snapshot tests, etc.) that hardcode `voxelSize: 2` in fixture data — those fixtures need corresponding position adjustments or `voxelSize: 0.5` if they are for the room editor path.

### 4. Per-object snap step from bounding box

`tileXRow`, `tileZReplicas`, `tileYReplicas`, and `snapToVoxel` currently assume every object steps by 1 voxel. After the grid change to 0.5 m, a 2×2×2 KayKit block occupies 4 voxels per side. The snap step for a tileable object on a given axis should be:

```
tileStep[axis] = max(1, round(objectDimension[axis] / voxelSize))
```

So a 2 m block on the 0.5 m grid has `tileStep = 4`. A 0.3 m object (smaller than voxelSize) uses `tileStep = 1`.

`checkMoveOccupancy` must expand to cover all voxels within the object's bounding box footprint (all cells `[x, x+w), [y, y+h), [z, z+d)` where `w/h/d` are the tileStep values).

### 5. Non-tileable snap

When placing or dragging a non-tileable object:
- Find the nearest tileable placed object (by Euclidean distance from cursor's raycast hit).
- Align the non-tileable object so its face nearest to that tileable object sits flush with that tileable object's matching face.
- If no tileable object exists within a reasonable radius (suggest 5 m), fall back to the 0.5 m world grid.

Implement as `snapToNearestTileableFace` in `roomSnap.ts`.

### 6. Drop-to-floor for gravity-enabled objects

When `kind.gravity === true` and an object is placed:
- Cast a ray straight down from the object's center position through `worldObjects` instances.
- Find the topmost collidable surface below (the top face of the nearest tileable object below, or `y = 0` if none).
- Return the settled voxel position — the object's `y` voxel is set so its bottom face rests on that surface.
- After placement the object is static (no dynamic Rapier body needed).

Implement as pure function `dropToFloor(position, kindDims, worldObjects)` in a new file `packages/studio/src/modes/room/dropToFloor.ts`.

### 7. Object editor — Tiling, Gravity, Optimization sections

Add to `ObjectKindEditorPanel.tsx`:
- **Tiling** section: three axis toggles (X / Y / Z). Wire through `applyPatch({ tilingAxes: ... })`.
- **Gravity** section: boolean toggle. Wire through `applyPatch({ gravity: ... })`.
- **Optimization** section: `SelectInput` with options `['none', 'static-batch', 'frustum-cull']`. Wire through `applyPatch({ optimization: ... })`. Show a small hint row: "scaffold — no runtime effect".

### 8. Tiling state machine — per-kind axis support

Generalize `TileState` in `SceneEditorCanvas.tsx`:
- At `idle` stage, derive `remainingAxes: Axis[]` from the staged kind's `tilingAxes`. If a kind tiles on no axes, tile-tool behaves like add-tool (single placement only).
- The stages `placed → [first-axis]-extruded → [second-axis]-extruded → [third-axis]-extruded` are now driven by `remainingAxes`, not hardcoded X/Z/Y.
- Extract the pure state-transition logic (axis selection, step calculation, ghost position derivation) into a separate module `packages/studio/src/modes/room/tileStateMachine.ts` where practical for testability.

**SRP note:** If the extraction makes the React integration unwieldy due to R3F's `useFrame`/`useThree` coupling, document the SRP violation inline per CLAUDE.md.

### 9. X/Y/Z keyboard shortcuts to switch next tiling axis

During an active tile gesture, pressing X, Y, or Z sets the next extrusion axis to that axis, provided:
- (a) the axis is tileable for the current kind, and
- (b) the axis hasn't been consumed yet in this gesture.

Show a hint in the existing UI hint area ("X / Y / Z — switch axis").

### 10. `<DirectionGizmo>` renderer primitive

Add `packages/world/src/renderer/DirectionGizmo.tsx` — a new renderer primitive (cone + cylinder) that renders a 3D arrow in-scene. Export it from `packages/world/src/renderer/index.ts`.

`SceneEditorCanvas.tsx` composes it during tile-tool gestures (after the origin is placed) to show the next extrusion direction. Uses `voxelSize` for world-space origin computation.

**DIP note:** Editor canvases must compose renderer primitives (CLAUDE.md rule). The bespoke THREE geometry belongs in the renderer package, not inlined in the canvas.

---

## Out of Scope (this PR)

- **Optimization behavior implementation**: `optimization` field is scaffolded only. `ObjectInstances.tsx` reads but does not act on the value. Future PR implements `static-batch` and `frustum-cull` paths.
- **Dynamic-physics gravity**: Objects with `gravity: true` are settled at placement time then become static. No `type="dynamic"` Rapier body, no runtime re-simulation, no network sync changes.
- **Network sync changes**: No changes to `PlaceObjectCommand` wire format; positions are integers under the new grid, same protocol.

---

## SOLID Notes

- **DIP** (`DirectionGizmo`): Adding the gizmo as a renderer primitive (not inline THREE geometry in the canvas) maintains the dependency inversion: editor canvases depend on renderer abstractions, not on raw THREE constructors.
- **OCP** (`optimization` enum): The enum fails to compile if a renderer switch adds a new variant without a case. The `WORLD_OBJECT_KIND_DEFAULTS` / `normalizeKind` structure is already OCP-safe — adding a new field means extending `WORLD_OBJECT_KIND_DEFAULTS` and the switch in `normalizeKind`, not editing every kind entry.
- **SRP**: Schema normalization (`normalizeKind`) stays separate from runtime rendering (`ObjectInstances`). The tiling state machine logic is extracted from the canvas component where feasible. The rename refactor (task-00) is a separate PR from the capability additions (task-01) — textbook SRP at the PR level.
- **ISP**: Callers that only care about tile behavior can destructure `tilingAxes` from `WorldObjectKind`; callers that only care about snap can destructure `gravity`.

---

## Testing Approach

TDD ON for tasks with pure functions: schema normalization (task-01), room migration (task-02), snap step / occupancy (task-04), non-tileable snap (task-05), drop-to-floor (task-06), tiling state machine logic (task-08 pure parts).

TDD OFF for rename tasks (task-00) and UI/rendering tasks (task-07, task-09, task-10).

Test framework: Vitest. Commands: `pnpm --filter @officexr/world test` and `pnpm --filter @officexr/studio test`.
