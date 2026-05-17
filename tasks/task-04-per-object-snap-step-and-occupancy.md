# Task 04: Per-Object Snap Step from Bounding Box and Multi-Voxel Occupancy

## Objective
Extend `snapToVoxel` (and the tile-tool helper functions) to step by the object's bounding-box-derived tile step rather than always 1 voxel, and expand `checkMoveOccupancy` to check all voxels a multi-voxel object occupies.

## Context

**Quick Context:**
- After task-03, `VOXEL_SIZE = 0.5`. A KayKit 2×2×2 block has bounding dimensions of approximately 2 m × 2 m × 2 m. On a 0.5 m grid, one block spans 4 voxels per axis (`tileStep = round(2.0 / 0.5) = 4`).
- `tileStep` per axis is derived from the kind's bounding dimensions and `voxelSize`. `WorldObjectKind` now has `tilingAxes` (from task-01) but NOT a stored `tileStep` field — the step is computed at runtime from the GLTF bounding box. The kind editor exposes bounding dimensions via `getKindBoundingDimensions` in `cube-material.ts`.
- The existing `checkMoveOccupancy` treats every object as occupying exactly 1 voxel. With multi-voxel footprints it must check all voxels `[x, x+w), [y, y+h), [z, z+d)`.

## Requirements

1. Add a pure helper `computeTileStep` to `roomSnap.ts`:
   ```ts
   export function computeTileStep(
     dimensionM: number,
     voxelSize: number,
   ): number
   ```
   Returns `Math.max(1, Math.round(dimensionM / voxelSize))`.

2. Add a pure helper `computeKindTileSteps` to `roomSnap.ts`:
   ```ts
   export function computeKindTileSteps(
     dims: { width: number; height: number; depth: number },
     voxelSize: number,
   ): { x: number; y: number; z: number }
   ```
   Returns `{ x: computeTileStep(dims.width, voxelSize), y: computeTileStep(dims.height, voxelSize), z: computeTileStep(dims.depth, voxelSize) }`.

3. Update `snapToVoxel` (or add a new `snapToVoxelStepped` overload — your preference) to accept an optional `step: { x: number; y: number; z: number }` parameter. When provided, the floor-hit case snaps to the nearest multiple of the step:
   ```ts
   Math.round(hit.point.x / voxelSize / step.x) * step.x
   ```
   When not provided, defaults to `{ x: 1, y: 1, z: 1 }` (existing behavior).

4. Update `tileXRow`, `tileZReplicas`, `tileYReplicas` in `SceneEditorCanvas.tsx` to accept an optional `step` parameter:
   - `tileXRow`: steps in `step.x` increments instead of 1.
   - `tileZReplicas`: steps in `step.z` increments.
   - `tileYReplicas`: steps in `step.y` increments.
   The `dx / step.x` delta is rounded to produce whole-step counts.

5. Update `checkMoveOccupancy` in `moveOccupancy.ts` to accept an optional `footprint: { w: number; h: number; d: number }` parameter (in voxels). When provided, the occupancy check tests all voxels `[x, x+w), [y, y+h), [z, z+d)` for each proposed position. Default is `{ w: 1, h: 1, d: 1 }` (existing behavior unchanged).
   - The signature becomes:
     ```ts
     export function checkMoveOccupancy(
       doc: RoomDocument,
       movingIds: ReadonlySet<string>,
       proposedPositions: ReadonlyMap<string, [number, number, number]>,
       footprint?: { w: number; h: number; d: number },
     ): 'ok' | 'blocked'
     ```

6. Export `computeTileStep` and `computeKindTileSteps` from `roomSnap.ts`.

## Existing Code References
- `packages/studio/src/modes/room/roomSnap.ts` — `snapToVoxel`, existing floor-hit rounding logic
- `packages/studio/src/modes/room/moveOccupancy.ts` — `checkMoveOccupancy`, `voxelKey`
- `packages/studio/src/modes/room/SceneEditorCanvas.tsx` — `tileXRow`, `tileZReplicas`, `tileYReplicas` (around lines 90–146)
- `packages/world/src/renderer/cube-material.ts` — `getKindBoundingDimensions` (for reference; the tile-tool will call this to get dimensions at runtime)

## Implementation Details
- The tile helper changes in `SceneEditorCanvas.tsx` are mechanical — each loop step changes from `i++` to `i += step.x` (etc.). The canvas calls `getKindBoundingDimensions` from the GLTF cache to derive steps; this can be done lazily (only computed once per staged kind).
- For the occupancy footprint, you'll also need to adjust how the occupancy set is built: the non-moving objects in the room each occupy their own footprint (not just 1 voxel). To keep this tractable, pass the same footprint for all objects in the move batch — this is correct for homogeneous multi-select.
- Keep backward compatibility: callers that don't pass `footprint` / `step` continue to work with the existing 1-voxel behavior.

## Acceptance Criteria
- [ ] `computeTileStep(2.0, 0.5)` returns `4`.
- [ ] `computeTileStep(0.3, 0.5)` returns `1`.
- [ ] `computeTileStep(1.0, 0.5)` returns `2`.
- [ ] `snapToVoxelStepped` (or the updated `snapToVoxel`) with `step.x = 4` on a floor hit at `x = 2.3` returns voxel `x = 4` (nearest multiple of 4 at `round(2.3/0.5/4)*4 = round(1.15)*4 = 1*4 = 4`).
- [ ] `checkMoveOccupancy` with `footprint: { w: 4, h: 4, d: 4 }` returns `'blocked'` when any of the 64 voxels the proposed object occupies is taken.
- [ ] `checkMoveOccupancy` with `footprint: { w: 4, h: 4, d: 4 }` returns `'ok'` when none of the 64 voxels is taken.
- [ ] Calling `checkMoveOccupancy` without a footprint still works as before (1-voxel check).
- [ ] `pnpm --filter @officexr/studio test` passes.
- [ ] Existing `roomSnap.test.ts` tests still pass.

## TDD Mode

This task uses Test-Driven Development. Write tests BEFORE implementation.

### Test Specifications
- **Test files**:
  - Add to `packages/studio/src/modes/room/roomSnap.test.ts`
  - Add to `packages/studio/src/modes/room/moveOccupancy.test.ts`
- **Test framework**: Vitest
- **Test command**: `pnpm --filter @officexr/studio test`

### Tests to Write (roomSnap)
1. **`computeTileStep — 2m object on 0.5m grid → step 4`**: `computeTileStep(2.0, 0.5) === 4`.
2. **`computeTileStep — small object below voxelSize → step 1`**: `computeTileStep(0.3, 0.5) === 1`.
3. **`computeTileStep — exactly 1m on 0.5m grid → step 2`**: `computeTileStep(1.0, 0.5) === 2`.
4. **`snapToVoxel stepped floor hit — step 4 snaps to multiples of 4`**: Hit at world x=2.3m with voxelSize=0.5 and stepX=4. Expected: voxel x=4.
5. **`snapToVoxel stepped floor hit — step 1 is same as existing behavior`**: Existing test cases still pass with step=1.

### Tests to Write (moveOccupancy)
6. **`checkMoveOccupancy — multi-voxel footprint catches overlap`**: Place a non-moving object at `[0,0,0]`. Propose a 4×4×4 footprint at `[-1, 0, -1]`. Expected: `'blocked'` because the footprint covers `[-1..2, 0..3, -1..2]` which includes `[0,0,0]`.
7. **`checkMoveOccupancy — multi-voxel footprint clears when no overlap`**: Place at `[10,0,10]`. Propose 4×4×4 at `[0,0,0]`. Expected: `'ok'`.
8. **`checkMoveOccupancy — default footprint still 1-voxel`**: Existing occupancy tests unchanged.

### TDD Process
1. Write all eight tests — FAIL (RED).
2. Implement `computeTileStep`, `computeKindTileSteps`, update `snapToVoxel`, update `checkMoveOccupancy` — GREEN.
3. Update `tileXRow` / `tileZReplicas` / `tileYReplicas` in `SceneEditorCanvas.tsx`.
4. Run `pnpm --filter @officexr/studio test`.

## Dependencies
- Depends on: task-01 (`tilingAxes` field needed to determine if an axis is tileable), task-03 (`voxelSize = 0.5`)
- Blocks: task-05, task-08
