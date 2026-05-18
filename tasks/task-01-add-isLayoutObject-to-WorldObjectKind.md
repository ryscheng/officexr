# Task 01: Add `isLayoutObject` to `WorldObjectKind`

## Objective
Add a boolean `isLayoutObject` field to `WorldObjectKind` so a kind can be marked as structural (walls / floors) vs furnishing. Default false. Persist cleanly for old kind catalogs that lack the field.

## Dependencies
None.

## Context Files
- `tasks/shared-context.md`
- `tasks/updated-prd.md`
- `packages/world/src/scenes/world-object-kinds-schema.ts` — the schema, defaults, and types to modify (lines 43-103 for the interface).
- `packages/world/src/scenes/world-object-kinds-schema.test.ts` — existing tests; add a case here.
- `packages/world/world-object-kinds.json` and `world-object-kinds.default.json` — existing on-disk catalogs that must still parse.
- `packages/world/src/scenes/index.ts` — barrel that re-exports the kind types.

## Files to Modify
- `packages/world/src/scenes/world-object-kinds-schema.ts`
- `packages/world/src/scenes/world-object-kinds-schema.test.ts` (add a test)

## Requirements
1. Add `isLayoutObject: boolean` to the zod schema for `WorldObjectKind` with `.default(false)` so older catalogs without the field still parse.
2. Add `isLayoutObject: false` to `WORLD_OBJECT_KIND_DEFAULTS`.
3. Update the TypeScript `WorldObjectKind` interface and any derived types.
4. Confirm the catalog deserialization path (`filesystem-catalog-storage.ts` etc.) does not block on the new field — defaults must apply.

## Acceptance Criteria
- `WorldObjectKind` parses both with and without `isLayoutObject`.
- All on-disk catalogs in `packages/world/world-object-kinds.json` and `world-object-kinds.default.json` continue to deserialize cleanly with `isLayoutObject` defaulting to `false`.
- A new test in `world-object-kinds-schema.test.ts` exercises both branches (field present, field absent → default false).
- `pnpm -C packages/world test` is green.
- `pnpm -C packages/world build` (or repo-root tsc / build) is green.

## Implementation Notes
- The kinds catalog is versioned (`schemaVersion: 1`). We do NOT need to bump it because the zod default makes the field backwards-compatible.
- Search for `WORLD_OBJECT_KIND_DEFAULTS` usages — any consumer that spreads it for placeholder kinds should automatically pick up the new field.
