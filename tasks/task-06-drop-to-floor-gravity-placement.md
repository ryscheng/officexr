# Task 06: Drop-to-Surface for Gravity-Enabled Placement

## Objective
Implement `dropToSurface` — a pure function that computes the settled voxel Y for a gravity-enabled object by finding the top of the highest object beneath it — and call it from the Add/Tile-tool placement path when `kind.gravity === true`. **A gravity-enabled object MAY ONLY be placed on top of another placed object's surface; if no supporting object exists beneath the proposed footprint, placement is REJECTED.**

## Context

**Quick Context:**
- When `kind.gravity === true`, the placed object must rest on the top face of an existing placed object. The world floor (`y = 0`) is NOT a valid support — gravity objects cannot float, and they cannot sit directly on the floor plane either.
- If no object is beneath the proposed footprint, the function returns `null` and the place tool must reject the placement (ghost shown as blocked, click does not commit).
- "At placement only" — once placed on a valid support, the object becomes a normal static object. No dynamic Rapier bodies, no ongoing simulation. If its supporting object is later deleted, the gravity object is NOT re-settled (out of scope for this task).
- The function is pure: it takes the proposed voxel position, the object's footprint in voxels, and the existing `worldObjects`, then returns the settled voxel position or `null`.

## Requirements

1. Create `packages/studio/src/modes/room/dropToSurface.ts` with:
   ```ts
   /**
    * Computes the settled voxel Y position for a gravity-enabled object
    * being placed at `proposedVoxel`. Returns `null` when no supporting
    * object exists beneath the proposed footprint — gravity-enabled objects
    * may only rest on top of another placed object.
    *
    * Algorithm:
    *   1. Find all existing instances whose voxel XZ footprint overlaps the
    *      proposed XZ footprint AND whose voxel Y is strictly less than
    *      `proposedVoxel[1]`.
    *   2. If none, return `null` (placement is invalid).
    *   3. `settledY = max(overlapping iy) + 1` (rest one voxel above the
    *      highest support).
    *   4. Returns `[proposedVoxel[0], settledY, proposedVoxel[2]]`.
    *
    * @param proposedVoxel - The voxel position where the user clicked to place
    * @param objectFootprint - Width and depth in voxels (use computeTileStep)
    * @param worldObjects - The current compiled scene (existing placed objects)
    */
   export function dropToSurface(
     proposedVoxel: [number, number, number],
     objectFootprint: { w: number; d: number },
     worldObjects: { voxelSize: number; instances: ReadonlyArray<{ position: readonly [number, number, number] }> },
   ): [number, number, number] | null
   ```

2. The XZ overlap check: an existing instance at voxel `[ix, iy, iz]` overlaps the proposed XZ footprint if:
   - `ix >= proposedVoxel[0] - objectFootprint.w/2` AND `ix < proposedVoxel[0] + objectFootprint.w/2`
   - `iz >= proposedVoxel[2] - objectFootprint.d/2` AND `iz < proposedVoxel[2] + objectFootprint.d/2`
   - (Centered footprint; if `w` is odd, round appropriately — see implementation details.)

3. "placedTop": for an instance at voxel Y `iy`, the top of the object is at voxel `iy + 1` (one voxel above its origin). `settledY = max(overlapping iy) + 1`. If no overlap → return `null` (no valid support; placement rejected).

4. In `SceneEditorCanvas.tsx`, update the Add-tool placement path (in `handleAddClick`) and the Tile-tool first-click path (in `handleTileClick` at the `idle` stage):
   - Look up the staged kind from the catalog.
   - If `kind.gravity === true`, compute `objectFootprint` from `kind` dimensions using `computeTileStep`, then call `dropToSurface(voxel, footprint, props.compiled)`.
   - If `dropToSurface` returns `null`, ABORT the placement — do not commit a `placeObject` command. Reuse the existing blocked-ghost visual state from the move tool to indicate the placement is invalid (mirror the pattern from `moveOccupancy`).
   - Otherwise, use the returned settled position instead of the raw snapped voxel.

5. Export `dropToSurface` from `dropToSurface.ts`.

## Existing Code References
- `packages/studio/src/modes/room/SceneEditorCanvas.tsx` — `handleAddClick` (line ~411), `handleTileClick` at `tileState.stage === 'idle'` (line ~439)
- `packages/studio/src/modes/room/moveOccupancy.ts` — reference for voxel iteration patterns
- `packages/studio/src/modes/room/roomSnap.ts` — `computeTileStep` (added in task-04)
- `packages/world/src/scenes/object-kind-catalog.ts` — `getKind(id)` for looking up `gravity` flag (renamed in task-00)

## Implementation Details
- The footprint is centered on the object's voxel X/Z. For a 4-voxel wide object at voxel x=8: XZ sweep is x ∈ [6, 10). Use integer arithmetic to avoid float issues.
- The function only looks downward (iy < proposedVoxel[1]). Objects at or above the proposed Y are ignored.
- The function does NOT need to use `voxelSize` — everything is in voxel coordinates. The `voxelSize` field on `worldObjects` is ignored; it's included in the type for future compatibility.
- In the canvas, use `React.useMemo` or a cached catalog lookup to avoid re-fetching `getKind` on every hover. The drop is only applied on click (placement), not on hover (ghost preview), so performance is not critical.
- Gravity drop is only applied during placement (Add tool and Tile tool first click). Move tool does NOT re-apply gravity.

## Acceptance Criteria
- [ ] `dropToSurface([0, 10, 0], { w: 1, d: 1 }, emptyWorldObjects)` returns `null` (placement rejected — no support below).
- [ ] `dropToSurface([0, 10, 0], { w: 1, d: 1 }, worldObjectsWith({position:[0,3,0]}))` returns `[0, 4, 0]` (lands on top of object at y=3).
- [ ] `dropToSurface` ignores objects whose XZ position does not overlap the footprint.
- [ ] `dropToSurface` ignores objects at or above `proposedVoxel[1]`.
- [ ] When a kind has `gravity: true` and the user places it on top of an existing object, the committed position uses the dropped Y, not the clicked Y.
- [ ] When a kind has `gravity: true` and the user attempts to place it where no supporting object exists beneath the footprint, the placement is rejected (no command committed) and the ghost shows the blocked state.
- [ ] When a kind has `gravity: false`, placement is unchanged.
- [ ] `pnpm --filter @officexr/studio test` passes.

## TDD Mode

This task uses Test-Driven Development. Write tests BEFORE implementation.

### Test Specifications
- **Test file**: `packages/studio/src/modes/room/dropToFloor.test.ts` (new file)
- **Test framework**: Vitest
- **Test command**: `pnpm --filter @officexr/studio test`

### Tests to Write
1. **`dropToSurface — empty world → null (rejected)`**: No instances. Proposed at `[0, 5, 0]`, footprint `{w:1, d:1}`. Expected: `null`.
2. **`dropToSurface — lands on top of single block at y=3`**: One instance at `[0, 3, 0]`. Proposed at `[0, 10, 0]`. Expected: `[0, 4, 0]`.
3. **`dropToSurface — lands on the highest block when stacked`**: Instances at `[0, 0, 0]` and `[0, 2, 0]`. Proposed at `[0, 10, 0]`. Expected: `[0, 3, 0]`.
4. **`dropToSurface — XZ out of footprint → null`**: Instance at `[5, 3, 0]` (far away). Proposed at `[0, 10, 0]`, footprint `{w:1, d:1}`. Expected: `null` (only out-of-footprint objects exist, so no valid support).
5. **`dropToSurface — object at or above proposed Y is ignored → null`**: Instance at `[0, 15, 0]` (above proposed). Expected: `null`.
6. **`dropToSurface — multi-voxel footprint matches correctly`**: Footprint `{w:4, d:4}`. Instance at `[1, 2, 1]` (within footprint). Expected: `[proposed[0], 3, proposed[2]]`.
7. **`dropToSurface — multi-voxel footprint does not match out-of-range instance → null`**: Footprint `{w:4, d:4}` centered at `[8, 10, 8]`. Instance at `[0, 5, 0]` (outside footprint). Expected: `null`.

### TDD Process
1. Write all seven tests — FAIL (RED).
2. Implement `dropToSurface` — GREEN.
3. Wire into `SceneEditorCanvas.tsx` (including the placement-rejection path when result is `null`).
4. Run `pnpm --filter @officexr/studio test`.

## Dependencies
- Depends on: task-01 (`gravity` field), task-03 (`voxelSize = 0.5`), task-04 (`computeTileStep` for footprint)
- Blocks: task-11
