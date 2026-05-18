# Task 10: Object editor — `isLayoutObject` toggle

## Objective
Surface the new `isLayoutObject` field in the Object editor as a labeled checkbox in the Placement section, wired to the existing kind-update flow.

## Dependencies
- Task 01 (`isLayoutObject` field exists).

## Context Files
- `tasks/shared-context.md`
- `tasks/updated-prd.md`
- `packages/studio/src/modes/object/ObjectKindEditorPanel.tsx:42-209` — existing sections (Kind, Dimensions, Material, Tiling, Placement, Optimization). The Placement section is around lines 190-196 and contains the existing `gravity` toggle.
- `packages/world/src/scenes/world-object-kinds-schema.ts` — `WorldObjectKind` typing.

## Files to Modify
- `packages/studio/src/modes/object/ObjectKindEditorPanel.tsx`

## Requirements
1. In the Placement section, add a checkbox / toggle:
   - Label: "Is layout object"
   - Sub-label or tooltip: "Walls, floors, structural geometry. Used in Layout view; hidden from Room view by default."
   - Wires to `applyPatch({ isLayoutObject })`.
2. Visually match the existing toggle style for `gravity` and other booleans.

## Acceptance Criteria
- Toggling and saving persists `isLayoutObject: true` to the kind JSON on disk.
- Reloading the editor reflects the persisted state.
- TypeScript compile clean.
- No regression in existing object editor behavior.

## Implementation Notes
- This is the smallest task in the build — should be ~10 lines of JSX plus the wire.
- Use the same component (`Toggle` / `Checkbox`) as the other booleans in the file — don't introduce a new pattern.
