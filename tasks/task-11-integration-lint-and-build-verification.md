# Task 11: Integration Touch-Up and Lint/Build Verification Pass

## Objective
Run all lint guards, build all packages, run all tests, and fix any remaining issues that surfaced from the task-00 through task-10 changes — particularly CLAUDE.md grep guards and the `lint:no-bespoke-renderer` script.

## Context

**Quick Context:**
- This is the final integration pass. All feature tasks (00–10) must be merged before this task runs.
- CLAUDE.md specifies two grep guards that must return zero matches:
  1. `grep -rn "from 'three'" packages/sdk packages/realtime-server packages/core-refactor`
  2. `grep -rn "from 'react'" packages/sdk packages/realtime-server packages/core-refactor`
- There is a `lint:no-bespoke-renderer` script (check `packages/studio/package.json` or root `package.json` for its definition). Run it and fix any violations.

## Requirements

1. Run the CLAUDE.md grep guards:
   ```bash
   grep -rn "from 'three'" packages/sdk packages/realtime-server packages/core-refactor
   grep -rn "from 'react'" packages/sdk packages/realtime-server packages/core-refactor
   ```
   Both must return zero matches. If any new violations were introduced by tasks 00–10, remove them.

2. Run the rename completeness checks from task-00:
   ```bash
   grep -rn "CubeKindEntry\|CubeKind\b" packages/ | grep -v "\.md"
   grep -rn "CUBE_KIND_DEFAULTS" packages/ | grep -v "\.md"
   grep -rn "PlaceCubeCommand" packages/ | grep -v "\.md"
   grep -rn "CUBE_SIZE\|cubeSize\b" packages/ | grep -v "\.md" | grep -v "// "
   grep -rn "/api/cube-kinds" packages/ | grep -v "\.md"
   grep -rn "KindEditorPanel" packages/ | grep -v "ObjectKindEditorPanel" | grep -v "\.md"
   ```
   All must return zero matches. If any slipped through, fix them now.

3. Run `pnpm lint:no-bespoke-renderer` (or find the equivalent in the project scripts). Fix any inline geometry or lighting violations flagged by the linter:
   - No `SEAM_OVERLAP` anywhere.
   - No inline `<directionalLight>`, `<hemisphereLight>`, `<ambientLight>`, etc. outside `packages/world/src/renderer/`.
   - The `DirectionGizmo` (task-10) being inside `packages/world/src/renderer/` should satisfy the constraint for canvas composition.

4. Run the full test suite:
   ```bash
   pnpm --filter @officexr/world test
   pnpm --filter @officexr/studio test
   ```
   All tests must pass. If any test fails due to the `voxelSize` change (task-03) or schema version change (task-02), fix the test to reflect the correct new behavior.

5. Run builds for all relevant packages:
   ```bash
   pnpm --filter @officexr/world build
   pnpm --filter @officexr/studio build
   pnpm --filter @officexr/sdk build
   ```
   No type errors permitted.

6. Specific integration checks:
   - **Room file round-trip**: Open the studio, load `default-v2` room. Confirm it renders correctly (objects at the right world positions). Verify the tile tool works for a block-category kind.
   - **Non-tileable kind**: Stage a furniture-category kind. Confirm it snaps to the nearest tileable face when a block exists nearby, or falls back to the 0.5 m grid.
   - **Gravity kind**: If any kind has `gravity: true` (set one manually via the Object editor if needed), confirm placement drops to the nearest surface below.
   - **Tiling axis switching**: With a block staged, start a tile gesture, press Z then X. Confirm the next extrusion axis updates.

7. Check that the `optimization` scaffold is in place:
   - `ObjectInstances.tsx` should have the TODO comment added in task-01.
   - The optimization select in `ObjectKindEditorPanel` (task-07) saves and loads correctly.

8. If the `default.json` room file or other room files were NOT re-saved in v4 form during task-02, do it now by running `migrateRoomV3toV4` on each file and writing the result.

## Existing Code References
- Root `package.json` — look for `lint:no-bespoke-renderer` script
- `packages/studio/package.json` — look for test/lint/build scripts
- `packages/world/src/renderer/ObjectInstances.tsx` — verify task-01 TODO comment is present
- All five room JSON files in `packages/world/rooms/`
- `packages/world/src/scenes/world-object-kinds-schema.ts` — renamed in task-00
- `packages/studio/src/modes/object/ObjectKindEditorPanel.tsx` — renamed in task-00

## Acceptance Criteria
- [ ] Both CLAUDE.md grep guards return zero matches.
- [ ] All task-00 rename completeness greps return zero matches.
- [ ] `pnpm lint:no-bespoke-renderer` passes (or the equivalent lint command passes).
- [ ] `pnpm --filter @officexr/world test` passes with zero failures.
- [ ] `pnpm --filter @officexr/studio test` passes with zero failures.
- [ ] `pnpm --filter @officexr/world build` succeeds.
- [ ] `pnpm --filter @officexr/studio build` succeeds.
- [ ] `pnpm --filter @officexr/sdk build` succeeds.
- [ ] All five room JSON files have `schemaVersion: 4` and `op: 'placeObject'`.
- [ ] No hardcoded `VOXEL_SIZE = 2` or `compileScene(doc, 2)` remain in non-test source (grepped per task-03 requirements).
- [ ] `ObjectInstances.tsx` contains the `// TODO(task-01): kind.optimization is read but not yet acted on.` comment.

## Dependencies
- Depends on: task-00, task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09, task-10
- Blocks: nothing (this is the final task)
