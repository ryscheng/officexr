# Task 08: Generalize Tiling State Machine for Per-Kind Axes

## Objective
Extract the pure tiling state-transition logic from `SceneEditorCanvas.tsx` into a testable `tileStateMachine.ts` module and generalize it to drive axis order from `kind.tilingAxes` rather than the fixed X→Z→Y sequence.

## Context

**Quick Context:**
- The current `TileState` machine in `SceneEditorCanvas.tsx` is hardcoded to X→Z→Y. With per-kind `tilingAxes`, the state machine must skip axes the kind doesn't tile on, allow axis reordering (via keyboard shortcuts in task-09), and support kinds that tile on only 1 or 2 axes.
- The tiling preview helpers (`tileXRow`, `tileZReplicas`, `tileYReplicas`) are axis-specific. They should be replaced with axis-generic versions.
- SRP: the pure state-transition logic (which axes are available, which is next, what the preview voxels are for a given hover) is separated from the React/R3F integration. The React component owns interaction events and `useState`; the pure module owns the state shape and transition rules.

## Requirements

1. Create `packages/studio/src/modes/room/tileStateMachine.ts` with the following pure exports:

   ```ts
   export type TileAxis = 'x' | 'y' | 'z';

   /** Axes that the current kind can tile on, ordered for display. */
   export function resolveAvailableAxes(tilingAxes: { x: boolean; y: boolean; z: boolean }): TileAxis[]

   /** The state machine state. Replaces the hardcoded TileState union in
    *  SceneEditorCanvas.tsx. The axis sequence is dynamic. */
   export type TileMachineState =
     | { stage: 'idle' }
     | {
         stage: 'placed';
         origin: [number, number, number];
         kindId: string;
         originCommandId: string;
         remainingAxes: TileAxis[];  // axes not yet consumed
         nextAxis: TileAxis;         // first of remainingAxes
       }
     | {
         stage: 'axis-extruded';     // replaces 'x-extruded' / 'z-extruded'
         consumedAxis: TileAxis;
         origin: [number, number, number];
         kindId: string;
         groupId: string;
         extrudedRow: readonly [number, number, number][];
         remainingAxes: TileAxis[];
         nextAxis: TileAxis | null;  // null when no more axes
       }
     // ... add more stages as needed for each successive extrusion

   /** Compute ghost voxels for the current state + cursor position. Pure. */
   export function computeTileGhosts(
     state: TileMachineState,
     hoverVoxel: [number, number, number] | null,
     tileStep: { x: number; y: number; z: number },
   ): [number, number, number][]

   /** Transition: switch the nextAxis to a different available axis.
    *  No-op if the requested axis is not in remainingAxes. */
   export function switchNextAxis(
     state: TileMachineState,
     axis: TileAxis,
   ): TileMachineState
   ```

2. Implement `resolveAvailableAxes`:
   - Returns the axes that are `true` in `tilingAxes`, in a fixed canonical order: X, Y, Z (or the natural order of the object — your choice; document it).
   - Example: `{ x: true, y: false, z: true }` → `['x', 'z']`.
   - An all-false `tilingAxes` → `[]` (kind doesn't tile at all; tile tool behaves like add tool).

3. Implement `computeTileGhosts` as a generalized replacement for `tileXRow` / `tileZReplicas` / `tileYReplicas`. The function:
   - In `idle` stage: returns `[hoverVoxel]` if hover is not null, else `[]`.
   - In `placed` stage with `nextAxis = 'x'`: returns voxels along ±X from origin toward hoverVoxel, stepping by `tileStep.x`.
   - In `placed` stage with `nextAxis = 'z'`: same logic along Z.
   - In `placed` stage with `nextAxis = 'y'`: same logic along Y.
   - In `axis-extruded` stages: replicate the accumulated row/grid along the nextAxis.
   - The function MUST be stateless and pure.

4. Implement `switchNextAxis` as a pure transition function.

5. Update `SceneEditorCanvas.tsx` to use `TileMachineState` from `tileStateMachine.ts`:
   - Replace the old `TileState` type with `TileMachineState`.
   - Replace the inline `tileXRow`, `tileZReplicas`, `tileYReplicas` calls with `computeTileGhosts`.
   - Derive `nextAxis` from the current state's `remainingAxes` — the canvas no longer hardcodes the axis sequence.
   - When a kind with empty `availableAxes` is staged, the tile tool behaves like the add tool (single placement, no multi-click extrusion).
   - Call `resolveAvailableAxes` when a new kind is staged (or when transitioning to `idle`) to seed `remainingAxes`.

6. **SRP violation documentation** (if required): If extracting the state machine makes the R3F canvas integration unwieldy (e.g. because `computeTileGhosts` needs camera/screen info for the Y-axis pixel-based delta), leave those parts in the canvas and document:
   ```ts
   // SRP violation: Y-axis delta computation (PIXELS_PER_VOXEL screen mapping)
   // stays inline in SceneEditorCanvas because it requires R3F's camera projection.
   // The pure tileStateMachine handles the axis-generic ghost computation for
   // X and Z; Y-delta is passed in as a pre-computed voxel count.
   ```

## Existing Code References
- `packages/studio/src/modes/room/SceneEditorCanvas.tsx` — current `TileState`, `tileXRow`, `tileZReplicas`, `tileYReplicas`, `handleTileClick`, the ghosts `useMemo` block
- `packages/studio/src/modes/room/tools.ts` — `Tool` type

## Implementation Details
- The `yDelta` / `PIXELS_PER_VOXEL` screen-mapping logic in the current canvas can remain in the canvas — it uses R3F's screen coordinates and doesn't belong in a pure module. Pass the resulting `yDelta` (integer voxels) into `computeTileGhosts` as part of the hover state.
- The new state machine stages should support up to three sequential extrusions (one per tileable axis). A kind with only 1 tileable axis has a 2-click machine (place → extrude → done). A kind with 0 tileable axes has a 1-click machine (place → done).
- Keep the `Esc` handler (cancel and return to select) — it still resets to `{ stage: 'idle' }`.

## Acceptance Criteria
- [ ] `resolveAvailableAxes({ x: true, y: false, z: true })` returns `['x', 'z']` (or documented ordering).
- [ ] `resolveAvailableAxes({ x: false, y: false, z: false })` returns `[]`.
- [ ] `computeTileGhosts` in `placed` stage with `nextAxis: 'x'` returns voxels along X from origin to hover, stepping by `tileStep.x`.
- [ ] `computeTileGhosts` in `placed` stage with `nextAxis: 'z'` returns voxels along Z.
- [ ] `switchNextAxis` changes `nextAxis` to the requested axis when it is in `remainingAxes`, and is a no-op otherwise.
- [ ] Tile tool in the canvas works correctly for a block kind (all 3 axes): 4-click extrusion sequence still functions.
- [ ] Tile tool for a furniture kind (0 tileable axes): single click places one object, tool returns to select.
- [ ] `pnpm --filter @officexr/studio test` passes.
- [ ] Existing tile-related behavior is not regressed.

## TDD Mode

This task uses Test-Driven Development for the pure module. Write tests BEFORE implementation.

### Test Specifications
- **Test file**: `packages/studio/src/modes/room/tileStateMachine.test.ts` (new file)
- **Test framework**: Vitest
- **Test command**: `pnpm --filter @officexr/studio test`

### Tests to Write
1. **`resolveAvailableAxes — all true → ['x', 'y', 'z']`**: Standard block.
2. **`resolveAvailableAxes — only X and Z → ['x', 'z']`**: Floor tile.
3. **`resolveAvailableAxes — none → []`**: Non-tileable kind.
4. **`computeTileGhosts — idle stage with hover → [hoverVoxel]`**: Returns a single ghost at hover.
5. **`computeTileGhosts — idle stage no hover → []`**: Returns empty.
6. **`computeTileGhosts — placed, nextAxis X, step 4`**: Origin `[0,0,0]`, hover voxel `[8,0,0]`, step x=4. Expected ghosts at `[4,0,0]` and `[8,0,0]` (2 steps of 4).
7. **`computeTileGhosts — placed, nextAxis Z, step 1`**: Origin `[0,0,0]`, hover `[0,0,3]`. Expected: `[0,0,1]`, `[0,0,2]`, `[0,0,3]`.
8. **`switchNextAxis — changes to valid axis`**: State with `remainingAxes: ['x', 'z']`, `nextAxis: 'x'`. Switch to `'z'`. Expected: `nextAxis === 'z'`.
9. **`switchNextAxis — no-op for axis not in remainingAxes`**: State with `remainingAxes: ['x']`. Switch to `'y'`. Expected: state unchanged.

### TDD Process
1. Write all nine tests — FAIL (RED).
2. Implement `tileStateMachine.ts` — GREEN.
3. Update `SceneEditorCanvas.tsx` to use the new module.
4. Run `pnpm --filter @officexr/studio test`.

## SOLID Notes
- **SRP**: Pure state-transition logic (`tileStateMachine.ts`) is separated from React/R3F integration (`SceneEditorCanvas.tsx`). The canvas is responsible for event handling and rendering; the state machine module is responsible for state shape and transition rules.
- **OCP**: New tiling behaviors (e.g. diagonal axes in a future PR) can be added to `tileStateMachine.ts` without modifying `SceneEditorCanvas.tsx`.

## Dependencies
- Depends on: task-01 (`tilingAxes`), task-04 (tile step for `computeTileGhosts`)
- Blocks: task-09, task-10
