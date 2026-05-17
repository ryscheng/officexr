# Task 03: Set VOXEL_SIZE = 0.5 Globally (Formerly CUBE_SIZE = 2)

## Objective
Change the authoritative `VOXEL_SIZE` constant in `config.ts` from 2 to 0.5 and update the three additional sites that still hardcode their own local `VOXEL_SIZE = 2`, making `VOXEL_SIZE` the single source of truth throughout the codebase.

## Context

**Quick Context:**
- After task-00, `CUBE_SIZE` has been renamed to `VOXEL_SIZE` everywhere. After task-02 migrates room positions by ×4, existing room data is correct for `voxelSize = 0.5`. This task wires the constant value change.
- Four sites had hardcoded `voxelSize = 2` (now named `VOXEL_SIZE` after task-00): `config.ts` (exported `VOXEL_SIZE`), `useRoomDocument.ts` (line ~150: `compileScene(doc, 2)`), `MapEditorCanvas.tsx` (local `const VOXEL_SIZE = 2`), `useMapPicker.ts` (local `const VOXEL_SIZE = 2`).
- Physics tests (`rules.test.ts`), SDK snapshot tests, and compile tests hardcode `voxelSize: 2` in fixture data. After this task, the Room editor uses 0.5. Tests that exercise the Room editor path should use 0.5; tests that exercise the SDK's generic `WorldObjects` interface may keep any value since `voxelSize` is a parameter, not a global assumption in the SDK.

## Requirements

1. In `packages/world/src/renderer/config.ts`:
   - Change `export const VOXEL_SIZE = 2;` to `export const VOXEL_SIZE = 0.5;`
   - Update the comment: `// 0.5 m grid — four voxels per KayKit 2×2×2 block (was 2 before v4 migration)`

2. In `packages/studio/src/modes/room/useRoomDocument.ts` (line ~150):
   - Replace `compileScene(doc, 2)` with `compileScene(doc, VOXEL_SIZE)`.
   - Ensure `VOXEL_SIZE` is imported from `@officexr/world/renderer` (or the correct import path — verify in `packages/world/package.json` exports).

3. In `packages/studio/src/modes/map/MapEditorCanvas.tsx`:
   - Remove the local `const VOXEL_SIZE = 2;` declaration.
   - Import `VOXEL_SIZE` from `@officexr/world/renderer`.
   - Verify all uses of `VOXEL_SIZE` in this file compile correctly — this file uses `VOXEL_SIZE` for voxel-to-world coordinate conversions; with the new value those conversions remain mathematically correct.

4. In `packages/studio/src/modes/debug/useMapPicker.ts`:
   - Remove the local `const VOXEL_SIZE = 2;` declaration.
   - Import `VOXEL_SIZE` from `@officexr/world/renderer`.

5. Audit every other place in the codebase that hardcodes `voxelSize: 2` as a literal:
   - SDK tests (`packages/sdk/src/__tests__/`) — these test the generic `WorldObjects` protocol and are NOT room-editor-specific. Leave them at `voxelSize: 2` (or any value) — the SDK is agnostic to the absolute value.
   - `packages/world/src/physics/rules.test.ts` — physics rules operate on `worldObjects.voxelSize` generically; leave fixture values alone.
   - `packages/world/src/scenes/compile.test.ts` and `packages/world/src/scenes/storage.test.ts` — these are unit tests for the compile/storage layer which take `voxelSize` as a parameter; their fixture value of `2` is valid because `compileScene` is parameter-agnostic. Leave them alone.
   - If any test specifically asserts room-editor behavior at `voxelSize = 2` and would now be wrong at `0.5`, update it.

6. After the change, run a grep to confirm no remaining hardcoded `VOXEL_SIZE = 2` or `compileScene(doc, 2)` exist in the studio or world packages' non-test source:
   ```bash
   grep -rn "VOXEL_SIZE = 2\|compileScene.*,\s*2)" packages/studio/src packages/world/src
   ```
   The result must be empty.

## Existing Code References
- `packages/world/src/renderer/config.ts` — the authoritative constant (renamed in task-00)
- `packages/studio/src/modes/room/useRoomDocument.ts` line ~150 — `compileScene(doc, 2)`
- `packages/studio/src/modes/map/MapEditorCanvas.tsx` — local `VOXEL_SIZE = 2` used throughout the file
- `packages/studio/src/modes/debug/useMapPicker.ts` line ~16 — local `VOXEL_SIZE = 2`

## Implementation Details
- Import path for `VOXEL_SIZE` in studio: verify what the existing `@officexr/world/renderer` subpath resolves to. Check `packages/world/package.json` exports.
- `MapEditorCanvas.tsx` uses `VOXEL_SIZE` in many expressions (voxel-to-world math, AABB calculations). Each usage remains correct after the constant changes value because the math is relative — the only observable change is the absolute scale of the map editor, which is intentional.

## Acceptance Criteria
- [ ] `VOXEL_SIZE` in `config.ts` is `0.5`.
- [ ] `useRoomDocument.ts` imports `VOXEL_SIZE` from the world package, not a literal `2`.
- [ ] `MapEditorCanvas.tsx` uses imported `VOXEL_SIZE`, not a local literal.
- [ ] `useMapPicker.ts` uses imported `VOXEL_SIZE`, not a local literal.
- [ ] Grep for `VOXEL_SIZE = 2` or `compileScene(doc, 2)` in non-test source returns no matches.
- [ ] `pnpm --filter @officexr/studio build` passes without type errors.
- [ ] `pnpm --filter @officexr/world build` passes without type errors.
- [ ] `pnpm --filter @officexr/studio test` passes.
- [ ] `pnpm --filter @officexr/world test` passes.
- [ ] Existing tests still pass (no regressions from the constant change).

## Dependencies
- Depends on: task-02 (room positions are ×4 before this constant changes, so rooms render correctly)
- Can run in parallel with: task-01 (schema changes are independent of the constant)
- Blocks: task-04, task-05, task-06 (all depend on voxelSize = 0.5)
