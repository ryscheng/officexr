# Task 05: Snap Non-Tileable Kinds to Nearest Tileable Object Face

## Objective
Implement `snapToNearestTileableFace` in `roomSnap.ts` — a snap helper that aligns a non-tileable object's nearest face flush with the nearest tileable placed object's face, with a fallback to the 0.5 m world grid.

## Context

**Quick Context:**
- Non-tileable objects (all non-`block` categories by default after task-01) should snap to the face of the nearest tileable placed object rather than to an arbitrary voxel grid.
- "Nearest tileable object" = closest by Euclidean distance from the cursor's raycast hit point among all placed objects whose kind has `tilingAxes.x || tilingAxes.y || tilingAxes.z` (any axis is tileable).
- Fallback: if no tileable object is within 5 m (world space), fall back to snapping to the 0.5 m world grid (same as the floor-hit case with `voxelSize=0.5`).

## Requirements

1. Add to `roomSnap.ts`:
   ```ts
   export interface TileableObjectInfo {
     position: readonly [number, number, number]; // voxel position
     /** Bounding dimensions in meters (from getKindBoundingDimensions) */
     dims: { width: number; height: number; depth: number };
   }

   /**
    * Snaps a non-tileable object to the face of the nearest tileable
    * placed object. Falls back to the 0.5m world grid if no tileable
    * object exists within `fallbackRadiusM` metres.
    *
    * @param hitWorldPoint - World-space cursor hit position
    * @param nonTileableDims - Bounding dimensions of the object being placed
    * @param tileableObjects - Placed tileable objects (voxel position + dims)
    * @param voxelSize - Current grid voxel size (0.5 after task-03)
    * @param fallbackRadiusM - Max distance to search for tileable objects (default 5)
    * @returns Voxel position for the non-tileable object
    */
   export function snapToNearestTileableFace(
     hitWorldPoint: { x: number; y: number; z: number },
     nonTileableDims: { width: number; height: number; depth: number },
     tileableObjects: readonly TileableObjectInfo[],
     voxelSize: number,
     fallbackRadiusM?: number,
   ): [number, number, number]
   ```

2. Algorithm for `snapToNearestTileableFace`:
   - Find the nearest tileable object by Euclidean distance from `hitWorldPoint` to each tileable object's world-space center (`pos[i] * voxelSize`).
   - If the nearest tileable object is farther than `fallbackRadiusM` (default 5 m), return the world-grid snap: `[round(x/voxelSize), round(y/voxelSize), round(z/voxelSize)]`.
   - Otherwise, determine which face of the nearest tileable object is closest to `hitWorldPoint` (the face whose plane has minimum distance to the hit point — check all 6 axis-aligned faces of the tileable object's AABB).
   - Compute the voxel position for the non-tileable object such that its nearest face is flush with that tileable face:
     - Aligned face means: the non-tileable object's face in the same direction as the tileable face's outward normal sits at the same world coordinate as the tileable face's surface.
     - Return this as voxel coords rounded to the 0.5 m grid.

3. The function is pure — no React, no THREE imports, no side effects. It takes plain numbers and returns a voxel triple.

4. Export `snapToNearestTileableFace` and `TileableObjectInfo` from `roomSnap.ts`.

5. In `SceneEditorCanvas.tsx` (or wherever Add/Tile-tool placement is dispatched), when the staged kind is non-tileable (i.e. `kind.tilingAxes.x === false && kind.tilingAxes.y === false && kind.tilingAxes.z === false`), use `snapToNearestTileableFace` instead of `snapToVoxel` for placement. For hover ghost previews, also switch to `snapToNearestTileableFace` so the ghost updates live.

   Pass `tileableObjects` derived from `compiled.instances` filtered by their kind's `tilingAxes` — you'll need to look up each kind in the catalog to check `tilingAxes`. Cache this filtered list per `compiled` change to avoid recomputing on every hover.

## Existing Code References
- `packages/studio/src/modes/room/roomSnap.ts` — existing `snapToVoxel`, `FloorHit`, `CubeHit`
- `packages/studio/src/modes/room/SceneEditorCanvas.tsx` — Add-tool click handler (`handleAddClick`, `handleTileClick`), ghost computation (`ghosts` useMemo)
- `packages/world/src/scenes/object-kind-catalog.ts` — `getKind(id)` for looking up kind capabilities (renamed in task-00)
- `packages/world/src/renderer/cube-material.ts` — `getKindBoundingDimensions` (for dims)

## Implementation Details
- The AABB of a tileable object at voxel position `[vx, vy, vz]` with dims `{width, height, depth}`:
  - World center: `(vx * voxelSize, vy * voxelSize + height/2, vz * voxelSize)`
  - Face planes (world coords):
    - +X face: `x = vx * voxelSize + width/2`
    - -X face: `x = vx * voxelSize - width/2`
    - +Y face: `y = vy * voxelSize + height`
    - -Y face: `y = vy * voxelSize`
    - +Z face: `z = vz * voxelSize + depth/2`
    - -Z face: `z = vz * voxelSize - depth/2`
- For the flush alignment: if the nearest face is the +X face at world x = `faceX`, and the non-tileable object has width `w`, then its center x should be at `faceX + w/2`, so voxel x = `round((faceX + w/2) / voxelSize)`.
- Keep the function pure by passing in all required data; don't call `getKind` from inside `roomSnap.ts` — that would create a dependency on `object-kind-catalog.ts`. The caller in `SceneEditorCanvas.tsx` resolves kinds and passes `TileableObjectInfo[]`.

## Acceptance Criteria
- [ ] `snapToNearestTileableFace` returns the world-grid fallback position when `tileableObjects` is empty.
- [ ] `snapToNearestTileableFace` returns the world-grid fallback when the nearest tileable object is farther than `fallbackRadiusM`.
- [ ] `snapToNearestTileableFace` returns a position that places the non-tileable object's nearest face flush with the nearest tileable face (within 1 voxel tolerance).
- [ ] The snap function is pure — no imports from `react`, `three`, or `object-kind-catalog`.
- [ ] When a non-tileable kind is staged in the Add tool, the ghost preview uses `snapToNearestTileableFace`.
- [ ] `pnpm --filter @officexr/studio test` passes.

## TDD Mode

This task uses Test-Driven Development. Write tests BEFORE implementation.

### Test Specifications
- **Test file**: Add a `describe('snapToNearestTileableFace')` block to `packages/studio/src/modes/room/roomSnap.test.ts`
- **Test framework**: Vitest
- **Test command**: `pnpm --filter @officexr/studio test`

### Tests to Write
1. **`fallback — no tileable objects → world grid snap`**: Empty `tileableObjects` array. Hit at `{x: 1.3, y: 0, z: 0.8}`, voxelSize=0.5. Expected: `[3, 0, 2]` (nearest 0.5m grid).
2. **`fallback — nearest tileable > fallbackRadiusM away → world grid snap`**: One tileable object at `[100, 0, 100]` (far away). Hit at `{x: 0, y: 0, z: 0}`. Expected: world-grid result (not flush with the distant object).
3. **`flush — chair snaps to +X face of adjacent block`**: A tileable block at voxel `[0, 0, 0]` with dims 2m×2m×2m and voxelSize=0.5. Hit point at `{x: 1.1, y: 0, z: 0}` (just past the +X face at world x=1). Chair dims 0.5m×0.5m×0.5m. Expected: voxel position places the chair's -X face at world x=1 (the block's +X face).
4. **`flush — object snaps to top (+Y) face of block below`**: Block at `[0, 0, 0]`, hit at `{x: 0, y: 1.2, z: 0}` (above the top face at world y=2). Expected: non-tileable object placed with its -Y face at world y=2.
5. **`flush — second nearest tileable is NOT chosen`**: Two tileable objects, one closer and one farther. The snap result matches the closer one.

### TDD Process
1. Write all five tests — FAIL (RED).
2. Implement `snapToNearestTileableFace` — GREEN.
3. Wire into `SceneEditorCanvas.tsx`.
4. Run full test suite.

## Dependencies
- Depends on: task-01 (`tilingAxes` field), task-03 (`voxelSize = 0.5`), task-04 (`computeTileStep` for understanding the relationship between dims and grid)
- Blocks: None directly; task-11 (integration lint pass)
