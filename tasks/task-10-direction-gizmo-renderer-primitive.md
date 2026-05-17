# Task 10: Add `<DirectionGizmo>` Renderer Primitive and Wire It Into the Tiling Tool

## Objective
Create a `<DirectionGizmo>` renderer primitive (cone + cylinder arrow mesh) in `packages/world/src/renderer/` and compose it in `SceneEditorCanvas.tsx` to show the next tiling extrusion direction during a tile gesture.

## Context

**Quick Context:**
- CLAUDE.md rule: "Editor canvases compose renderer primitives; they don't re-implement them." The DirectionGizmo must live in `packages/world/src/renderer/`, not be inlined in the canvas.
- `SceneEditorCanvas.tsx` already imports THREE and R3F — it's a canvas file, so `import * as THREE` is allowed. BUT the gizmo geometry belongs in the renderer package because other future editors may need it.
- The gizmo should be a simple composed mesh: a cylinder for the shaft + a cone for the arrowhead, pointing in the +Y direction by default, rotated to face the current extrusion axis direction.

## Requirements

1. Create `packages/world/src/renderer/DirectionGizmo.tsx`:
   ```tsx
   interface DirectionGizmoProps {
     /** World-space origin of the arrow tail. */
     origin: [number, number, number];
     /** Unit vector pointing in the extrusion direction. E.g. [1,0,0] for +X. */
     direction: [number, number, number];
     /** CSS hex color for the arrow mesh. Default '#facc15' (yellow). */
     color?: string;
     /** Total length of the arrow (shaft + head) in world units. Default 1.5. */
     length?: number;
   }

   export function DirectionGizmo({ origin, direction, color, length }: DirectionGizmoProps)
   ```

2. Implementation:
   - Default `color = '#facc15'` and `length = 1.5`.
   - Shaft: `<cylinderGeometry args={[0.05, 0.05, length * 0.7, 8]}` centered at `length * 0.35` along the direction.
   - Head: `<coneGeometry args={[0.15, length * 0.3, 8]}` positioned at `length * 0.85` along the direction.
   - Use `THREE.Quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), dirVec)` to rotate the group from +Y to the target direction.
   - Wrap both meshes in a `<group>` positioned at `origin` with the computed rotation.
   - Material: `<meshBasicMaterial color={color} />` (no lighting dependency — visible in any lighting condition).

3. Export from `packages/world/src/renderer/index.ts`:
   ```ts
   export { DirectionGizmo } from './DirectionGizmo.tsx';
   ```

4. In `SceneEditorCanvas.tsx`:
   - Import `DirectionGizmo` from `@officexr/world/renderer`.
   - After the origin object is placed (state is `placed` or `axis-extruded`), render a `<DirectionGizmo>` inside the Canvas (alongside `GhostLayer`, `SelectionOutline`, etc.) with:
     - `origin`: the world-space position of the next extrusion start point (derived from the last committed position × `voxelSize`).
     - `direction`: the unit vector for `nextAxis` (`[1,0,0]` for X, `[0,1,0]` for Y, `[0,0,1]` for Z).
     - `color`: a distinguishing color per axis (e.g. red for X, green for Y, blue for Z, or just a fixed yellow).
   - Remove the gizmo when `tileState.stage === 'idle'` or `nextAxis` is null.

5. The gizmo is NOT rendered during the `z-extruded` / final Y-axis stage if `nextAxis` is null (no more axes to tile).

## Existing Code References
- `packages/world/src/renderer/EndlessGrid.tsx` — example of a simple renderer primitive (pattern to follow)
- `packages/world/src/renderer/GradientBackground.tsx` — another simple primitive
- `packages/world/src/renderer/index.ts` — add the export here
- `packages/studio/src/modes/room/SceneEditorCanvas.tsx` — Canvas JSX (around line 522–577) where `GhostLayer`, `SelectionOutline`, etc. are rendered

## Implementation Details
- `import * as THREE` is allowed in `DirectionGizmo.tsx` because it lives in `packages/world/src/renderer/`.
- The rotation quaternion: `new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), new THREE.Vector3(...direction))`. Use `useMemo` on this computation to avoid re-creating on every frame.
- If `direction` is exactly `[0,-1,0]` (anti-parallel to +Y), `setFromUnitVectors` degenerates. Handle this edge case by using a manual 180° rotation around X or Z.
- The gizmo does NOT need shadows or LOD. `meshBasicMaterial` with `depthTest: false` and `renderOrder={1}` makes it visible on top of other geometry, which is preferable for a gizmo.
- Uses `voxelSize` (renamed in task-00) when computing world-space origin from voxel position.

## Acceptance Criteria
- [ ] `<DirectionGizmo origin={[0,0,0]} direction={[1,0,0]} />` renders an arrow pointing in the +X direction in the scene.
- [ ] `<DirectionGizmo origin={[0,0,0]} direction={[0,1,0]} />` renders an arrow pointing up (+Y).
- [ ] `<DirectionGizmo origin={[0,0,0]} direction={[0,0,1]} />` renders an arrow pointing +Z.
- [ ] The gizmo appears in the Room editor when the tile tool has placed the origin object.
- [ ] The gizmo disappears when the tile gesture completes or is cancelled.
- [ ] `DirectionGizmo` is exported from `packages/world/src/renderer/index.ts`.
- [ ] No `import 'three'` appears in `packages/sdk`, `packages/realtime-server`, or `packages/core-refactor` (CLAUDE.md grep guard).
- [ ] `pnpm --filter @officexr/world build` passes without type errors.
- [ ] `pnpm --filter @officexr/studio build` passes without type errors.
- [ ] `pnpm lint:no-bespoke-renderer` (if it exists) passes.

## SOLID Notes
- **DIP**: `DirectionGizmo` lives in the renderer package. `SceneEditorCanvas.tsx` imports it as a renderer primitive, not by reaching into THREE directly to build the arrow geometry. This keeps the canvas free of raw mesh construction code.
- **SRP**: `DirectionGizmo.tsx` does one thing — render an arrow gizmo. The canvas decides when and where to render it.

## Dependencies
- Depends on: task-08 (tiling state machine provides `nextAxis` and origin)
- Blocks: task-11
