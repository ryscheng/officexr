# Planning Questions — Object Capabilities (Tiling, Gravity, Optimization, Snap)

## Codebase Summary

### What currently exists

**Object / kind definition (`packages/world/src/scenes/cube-kinds-schema.ts`)**
`CubeKindEntry` is the canonical type for an object kind. Current fields: `id`, `label`, `gltfPath`, `swatch`, `walkable`, `scale`, `tint`, `opacity`, `roughness`, `metalness`, `emissive`, `emissiveIntensity`, `category`. No capability flags exist yet. The catalog lives in `packages/world/cube-kinds.json` (281 kinds after asset-pack install) with a bundled default at `cube-kinds.default.json`. Loaded, validated, and live-patched via `packages/world/src/scenes/cube-catalog.ts`. Edits round-trip to `/api/cube-kinds` with a 500 ms debounce.

**Room document and placed-object schema (`packages/world/src/scenes/commands.ts`)**
Placed objects are stored as `PlaceCubeCommand { op: 'placeCube', kindId, position: [x,y,z] }`. The `RoomDocument` (v3) is a command list with groups. No per-instance data beyond position and kindId. Existing room files (`packages/world/rooms/*.json`) use `schemaVersion: 3` and the `op: "placeCube"` op throughout.

**Compile step (`packages/world/src/scenes/compile.ts`)**
`compileScene(doc, cubeSize)` replays commands into `WorldObjects { cubeSize, instances: ObjectInstance[] }`. Currently always called with `cubeSize = 2` (hardcoded in `useRoomDocument.ts` at line 150). `CUBE_SIZE = 2` is also hardcoded in `config.ts`, `MapEditorCanvas.tsx`, and `useMapPicker.ts`.

**Snap logic (`packages/studio/src/modes/room/roomSnap.ts`)**
`snapToVoxel(hit, cubeSize)` — for a floor hit: `round(worldX / cubeSize)` giving integer voxel coords. For a cube hit: `cubePosition + quantizedFaceNormal`. No concept of "tileable vs. non-tileable" axes. The snap increment is implicitly `cubeSize` (2m today) on all axes.

**Tiling tool (`packages/studio/src/modes/room/SceneEditorCanvas.tsx`)**
4-stage state machine: `idle → placed → x-extruded → z-extruded`. Click 1 places origin; click 2 commits X row; click 3 commits Z slab; click 4 commits Y stack. Axis order is **fixed**: always X first, then Z, then Y. No axis switching, no arrow indicator. The tool computes preview ghosts by replaying `tileXRow`, `tileZReplicas`, `tileYReplicas` on every hover.

**Object editor UI (`packages/studio/src/modes/object/KindEditorPanel.tsx`)**
Fully-controlled panel built on the in-house control kit (`Section`, `Toggle`, `NumberInput`, `ColorInput`, `NullableField`, `SelectInput`). No Leva. New toggles/sections can be added by extending this component and patching `CubeKindEntry`. The panel's `applyPatch` call routes to `patchKind` in `cube-catalog.ts`.

**Physics — placed objects (`packages/world/src/renderer/MapColliders.tsx`, `packages/world/src/physics/rules.ts`)**
All placed objects today are **static** (one `<RigidBody type="fixed">` holding one `<CuboidCollider>` per instance). `GRAVITY = -20 m/s²` exists in `rules.ts` but applies only to **characters** via Rapier's `KinematicCharacterController`. There is no dynamic rigid body for placed objects. Objects have no runtime physics simulation of their own.

**Renderer (`packages/world/src/renderer/ObjectInstances.tsx`)**
One `<instancedMesh>` per kind. Already uses `THREE.InstancedMesh` (GPU instancing is always on). No LOD, no frustum culling hints, no mesh-merge/static-batch. Scale is per-kind (`kind.scale`); positions are integer voxel × cubeSize.

**Voxel occupancy / move tool (`packages/studio/src/modes/room/moveOccupancy.ts`)**
Occupancy is checked by comparing proposed positions (integer voxel triples) to existing non-moving commands. No concept of object bounding-box size — all objects are treated as occupying exactly one voxel cell.

---

## Questions

### Q1: What does "Optimization capabilities" mean?

**Context:** The PRD lists "Optimization capabilities" as a per-kind toggle in the object editor, but does not define what it means. The renderer already uses `THREE.InstancedMesh` (GPU instancing is always on for every kind). There is currently no LOD, no static-batching (mesh merging), and no per-kind frustum-culling hint. Three realistic candidates exist:

A) **Static-batching / merge toggle** — kinds flagged "optimize" could have their instances merged into one `THREE.BufferGeometry` at compile time, eliminating per-draw-call overhead at the cost of losing per-instance transforms. This would be a new code path in `ObjectInstances.tsx`.

B) **Frustum-cull hint** — a boolean that enables `mesh.frustumCulled = true` (Three.js default is `true` but `InstancedMesh` typically has it disabled for correctness; this toggle says "safe to cull"). Lowest-effort option; may produce visual pop-in on large instances.

C) **Scaffold the field only, defer implementation** — add `optimization: 'none' | 'static-batch' | 'frustum-cull'` to `CubeKindEntry` and the editor UI, but leave the renderer unchanged for now. The field is persisted and reserved for a follow-up PR.

D) **Defer entirely** — don't add the field yet; punt the whole concept to a follow-up PR with a clearer spec.

**Question:** Which of these matches your intent? If none, please describe what "optimization" should mean for a placed object.

---

### Q2: Migration defaults — what capabilities should existing objects get?

**Context:** All 281 kinds in `cube-kinds.json` have no capability fields. Every room file (`meeting-room-1.json`, `test-room.json`, etc.) uses `op: "placeCube"` with no capability annotation. The kind schema has a `CUBE_KIND_DEFAULTS` object in `cube-kinds-schema.ts` that normalizes missing fields when loading JSON. Adding new fields requires extending this defaults object.

The most consequential default question is the **tiling axes**: if blocks (the original KayKit BlockBits cubes, all `"category": "block"`) default to fully tileable (all axes), the tiling tool continues to work as before for them. If objects default to non-tileable, all existing catalog entries that were previously used as floor/wall tiles break.

**Question:** What defaults should new capability fields receive for existing catalog entries on load? Specifically:

A) **Block category = tileable on all axes; all other categories = non-tileable**
B) **All existing kinds = tileable on all axes** (safest migration; preserves today's behavior everywhere)
C) **All existing kinds = non-tileable by default** (requires explicitly re-enabling for every block kind)
D) **Author explicitly defines it for each kind** (no migration default — the editor must be visited to set capabilities before objects tile properly)

For gravity: should existing objects default to "gravity off" (static, current behavior) or "gravity on"?

---

### Q3: Snap increment for tileable objects — confirmation of 0.5 m grid

**Context:** Currently `cubeSize = 2` is hardcoded everywhere (`CUBE_SIZE = 2` in `config.ts`, `compileScene(doc, 2)` in `useRoomDocument.ts`, `CUBE_SIZE` in `MapEditorCanvas.tsx` and `useMapPicker.ts`). The PRD says tileable objects should snap to 0.5 m increments.

`snapToVoxel` works in integer voxel coordinates: `round(worldPos / cubeSize)`. If `cubeSize` changes from 2 to 0.5, the integer voxel grid becomes 4× finer. All existing cube positions are integers under cubeSize=2, i.e. `[0,0,0]`, `[1,0,0]`, `[-4,0,0]`, etc. Under cubeSize=0.5 these same positions correspond to world positions at 0, 0.5, 2.0 m intervals — they all remain valid, so existing saved room JSON stays correct.

However, the KayKit 2×2×2 blocks are 2 m cubes. On a 0.5 m grid, dragging a 2 m block by 1 voxel (0.5 m) would make it overlap its neighboring block. The occupancy check (`checkMoveOccupancy`) currently treats every object as occupying exactly one voxel, regardless of physical size.

**Question:** How should the tile step and occupancy be handled for objects larger than 0.5 m?

A) **Minimum tile step = object's bounding-box dimension on that axis** — a 2×2×2 block can only tile in 2 m increments even on the 0.5 m grid. Objects smaller than 0.5 m use 0.5 m. The occupancy check expands to cover all voxels the object occupies.
B) **Always 0.5 m step; occupancy check prevents overlaps** — the tool allows 0.5 m moves but the occupancy check blocks placement if the bounding box overlaps another object. The user sees a red ghost and cannot commit.
C) **Per-kind tile step** — add a `tileStep` numeric field to `CubeKindEntry` so each kind declares its own grid increment. The 2×2×2 block defaults to `tileStep: 2`; a 0.5 m tile defaults to `tileStep: 0.5`.
D) **Other** — describe.

---

### Q4: Backward compatibility — existing cube placements on the new grid

**Context:** All existing rooms (`meeting-room-1.json`, `test-room.json`, `platform.json`, etc.) store positions as integer coordinates under `cubeSize = 2`. These positions are `[-8, 0, 0]`, `[2, 0, -5]`, etc. Under the new regime where `cubeSize = 0.5`, the visual positions of these cubes remain identical (world space = voxel × cubeSize, so `[-8] × 0.5 = -4 m` vs. `[-8] × 2 = -16 m` — they would be at different world positions unless coordinates are migrated).

Two interpretations exist:

A) **cubeSize stays at 2; snap increment changes independently** — the coordinate system doesn't change. A new concept of "snap step" (separate from cubeSize) is introduced. The snap step for tileable objects is 0.5 m, but positions are still stored in 2 m voxels. Non-integer voxel positions (0.5/2 = 0.25 voxels) would require `position` to become `float` instead of `int`, or a separate "fine-grid" coordinate system.

B) **cubeSize changes to 0.5 and all existing voxel coordinates are scaled** — a migration step multiplies all `position` values by 4 (so `[-8, 0, 0]` at cubeSize=2 becomes `[-32, 0, 0]` at cubeSize=0.5, preserving world position). Room files get a schema version bump. Existing rooms continue to look identical after migration.

C) **cubeSize stays at 2; non-tileable snap uses a sub-voxel offset system** — positions remain integer × cubeSize for tileable objects; non-tileable objects store a world-space position (not voxel) and snap to the nearest tileable object face.

**Question:** Which interpretation do you intend, and are you comfortable with a coordinate migration for existing rooms (option B)?

---

### Q5: Snap behavior for non-tileable objects — what does "snap to the closest tileable object" mean geometrically?

**Context:** The PRD says non-tileable objects "will snap to the closest tileable object." In the current system, snap always produces integer voxel coordinates. For non-tileable objects the situation is less clear.

**Question:** When placing a non-tileable object (e.g. a chair from the furniture pack) adjacent to a tileable block, what exactly should the snap target be?

A) **Snap to the face of the nearest tileable object** — the chair's center is placed flush against the surface of the nearest tileable cube face. E.g. a block's top face at world y=2 → chair center at y=2 (sits on top). Snap axis by axis: find the tileable object whose bounding box is closest, then align the non-tileable object's face to that bounding box face.

B) **Snap to the voxel cell adjacent to the nearest tileable object** (same as current cube-face snapping) — the non-tileable object occupies the grid cell one step in the face-normal direction from the hit. Behaves identically to today's Add-tool cube-face hit.

C) **Snap to world origin / no snap** — non-tileable objects are placed in world space at the raw raycast hit point, with no grid snap. They float wherever you click.

D) **Snap to the nearest 0.5 m world grid regardless of tileable objects** — non-tileable objects still snap to a fine grid, just not the tileable-object faces specifically.

---

### Q6: Tiling tool axis-switch UX — how does the user change tiling axis?

**Context:** The current tile tool has a fixed axis order: X first, then Z, then Y. It is a 4-click state machine. The PRD says:
- The tiling UX should adjust based on which axes the object can tile in (e.g. a floor tile that can only tile in X/Z shouldn't offer Y).
- The user should be able to **switch** to "remaining axes that have gone unused" during the tiling gesture.

The state machine at `SceneEditorCanvas.tsx:TileState` would need to be generalized to allow axis reordering or dynamic axis selection.

**Question:** How should the user switch between available axes mid-gesture?

A) **Keyboard shortcuts (X/Y/Z keys)** — pressing X sets the next axis to X, Y sets it to Y, Z sets it to Z. User explicitly names the axis they want next.

B) **Tab key cycles through remaining axes** — Tab advances to the next unused tileable axis. Mirrors the PRD's phrasing ("remaining axes that have gone unused").

C) **On-canvas arrow handles (click to switch axis)** — in-scene 3D arrow(s) are clickable to redirect the next tiling dimension. More discoverable but requires 3D picking and more renderer complexity.

D) **A small HUD dropdown / button group** — a 2D overlay in the corner shows the available axes (e.g. `[X] [Z] [Y]`) and the active one is highlighted. Clicking a button switches axis.

Which option do you prefer? Can multiple be combined (e.g. B + D)?

---

### Q7: Arrow indicator visual — how should the tiling direction be shown?

**Context:** The PRD asks for "an arrow indicator pointing in the current direction that the tool is tiling." Currently there is no directional indicator — the ghost preview (transparent cubes) is the only visual feedback. The renderer package exports `<ObjectInstances>`, `<LightingRig>`, `<EndlessGrid>`, `<GhostLayer>`, but no arrow/gizmo primitive. Per CLAUDE.md, editor overlays must layer on top of renderer primitives rather than re-implement them.

Adding a 3D arrow would require either: (a) a new primitive in `packages/world/src/renderer/`, or (b) inline Three.js geometry in the editor canvas (which is allowed in canvas files per CLAUDE.md's "no new `import * as THREE` outside renderer" rule — `SceneEditorCanvas.tsx` is a canvas file that already `import * as THREE`).

**Question:** What form should the tiling direction arrow take?

A) **3D arrow gizmo in-scene** — a cone + cylinder mesh rendered at the origin of the current tiling axis, pointing in the tiling direction. Pure Three.js geometry created inline in `SceneEditorCanvas.tsx`. Rotates when the axis changes.

B) **2D HUD overlay** — a React element (SVG arrow or text label like "→ X axis") rendered on top of the canvas via absolute-position CSS. No Three.js, no renderer change. Simpler, but not spatially anchored to the scene.

C) **Scene-anchored sprite / billboard** — a flat plane mesh (always faces camera) at the tiling origin with an arrow texture. Requires a sprite asset or programmatic texture.

D) **Extend the existing ghost preview** — a differently-colored leading ghost cube (e.g. bright outline, distinct color) that indicates the direction, with no explicit arrow. Minimum code change.

Which option do you prefer?

---

### Q8: Gravity behavior — when and how does it apply?

**Context:** The PRD says "some objects should ignore gravity (as in, they will collide with other objects but they aren't subject to gravitational pull)." Today, ALL placed objects are static (`<RigidBody type="fixed">` in `MapColliders.tsx`). There is no dynamic simulation for placed objects. Player/bot gravity uses Rapier's `KinematicCharacterController` via the `GRAVITY = -20` constant in `rules.ts`.

Adding per-object gravity would require replacing `type="fixed"` with `type="dynamic"` for gravity-enabled objects in `MapColliders.tsx`, and wiring Rapier's gravity for those objects. This is a significant physics change; dynamic objects would settle at startup (falling onto static surfaces), then be treated as obstacles by the character controller.

**Question:** What is the intended behavior when an object has gravity enabled?

A) **At placement only** — when the user places a gravity-enabled object in the editor, it "falls" onto the nearest static surface below it and then becomes static. Runtime gameplay: it behaves like any other static collider. No dynamic simulation during gameplay.

B) **Continuously at gameplay runtime** — gravity-enabled objects use Rapier dynamic rigid bodies during gameplay. They fall, settle, and can potentially be displaced by players walking into them (depending on mass). The editor still places them at an authored position; the physics engine takes over at runtime.

C) **Neither — it's purely a design tag** — "gravity enabled" means the object DOES NOT float; it must be supported by geometry below it to make semantic sense (a table can't hang in mid-air). The field is a content validation hint for the level designer, not a runtime physics flag.

D) **Other** — describe.

Also: if gravity is enabled (option B), can the player push/move the object? Does it sync over network?

---

### Q9: TDD mode for this build

**Context:** The test infrastructure uses Vitest (discovered in `packages/studio/src/modes/room/roomSnap.test.ts` and `packages/world/src/bot/BotDriver.test.ts`). Test commands are `pnpm --filter @officexr/world test` and `pnpm --filter @officexr/studio test`. Test files sit alongside source (`*.test.ts`, `*.test.tsx`). The existing test coverage includes unit tests for `snapToVoxel`, `compileScene`, `checkMoveOccupancy`, `moveDelta`, and `RoomHistory`.

**Question:** Do you want TDD mode for this build? If yes, the task implementer will write failing tests before implementation code for each task. Given the existing test patterns (pure function units for snap/compile/occupancy logic), TDD is well-suited to:
- The new snap logic (new behavior for tileable vs. non-tileable objects)
- The `CubeKindEntry` schema extension (validation/normalization)
- The tiling state machine changes

TDD is less natural for:
- The UI panels (KindEditorPanel additions)
- The Three.js arrow gizmo

Yes / No?
