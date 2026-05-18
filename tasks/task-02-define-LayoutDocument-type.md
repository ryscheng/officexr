# Task 02: Define `LayoutDocument` type and (de)serialization

## Objective
Introduce `LayoutDocumentV1` — a thin sibling of `RoomDocument` that holds only `SceneCommand[]` for structural geometry. Provide `serializeLayout` and `deserializeLayout` mirroring the room counterparts.

## Dependencies
None (parallel with Task 01 and Task 03).

## Context Files
- `tasks/shared-context.md`
- `tasks/updated-prd.md`
- `packages/world/src/scenes/commands.ts` — `RoomDocument` and `SceneCommand` definitions; reuse `SceneCommand[]` here.
- `packages/world/src/scenes/serialize.ts:162` — `deserializeScene()` gate to mirror for layouts.
- `packages/world/src/scenes/serialize.ts` (whole file) — for `SerializedRoomV*` types and the `migrateToV*` chain.
- `packages/world/src/scenes/index.ts` — barrel; export the new type.

## Files to Create
- `packages/world/src/scenes/layout-document.ts`

## Files to Modify
- `packages/world/src/scenes/serialize.ts` (add `serializeLayout`, `deserializeLayout`, and a `SerializedLayoutV1` type)
- `packages/world/src/scenes/index.ts` (export `LayoutDocument`, `LayoutDocumentV1`, `serializeLayout`, `deserializeLayout`)
- `packages/world/src/scenes/migration.test.ts` or a new sibling test file — round-trip test for `LayoutDocument`

## Requirements
1. Define `LayoutDocumentV1`:
   ```
   interface LayoutDocumentV1 {
     schemaVersion: 1;
     name: string;
     title?: string;
     updatedAt?: number;
     commands: SceneCommand[];
   }
   export type LayoutDocument = LayoutDocumentV1;
   ```
2. Add a `SerializedLayoutV1` type (mirrors the room serialized shape) and `serializeLayout` / `deserializeLayout` functions. The deserialize gate must throw with the same diagnostic shape as `deserializeScene` (missing `name`, unsupported `schemaVersion`, missing `commands` array).
3. Layout commands are constrained to `SceneCommand[]` — for now do NOT validate that referenced kinds are `isLayoutObject: true` at deserialize time. That check belongs in the layout editor UI and the bake service.
4. Add a round-trip test.

## Acceptance Criteria
- A LayoutDocument can be serialized and parsed back to the same shape (round-trip test passes).
- `deserializeLayout` throws on missing `name`, missing `commands`, or wrong `schemaVersion`.
- `pnpm -C packages/world test` is green.
- TypeScript compile clean.

## Implementation Notes
- Match the diagnostic message style of `deserializeScene` exactly so error handling in consumers is uniform.
- Do NOT add `groups: Record<string, RoomGroup>` to `LayoutDocument` — layouts don't need command grouping for v1. If we add it later we'll bump the layout schema.
