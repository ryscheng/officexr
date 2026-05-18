# Task 03: RoomDocument v4 → v5 migration with `layoutName`

## Objective
Bump `RoomDocument.schemaVersion` from 4 to 5, adding an optional `layoutName?: string` reference to a layout. Provide `migrateRoomV4toV5` and chain it from the master migrator. Add a migration test.

## Dependencies
None (parallel with Tasks 01 and 02).

## Context Files
- `tasks/shared-context.md`
- `tasks/updated-prd.md`
- `packages/world/src/scenes/commands.ts:111` — `RoomDocument` interface.
- `packages/world/src/scenes/serialize.ts:162` — `deserializeScene()` validation gate.
- `packages/world/src/scenes/serialize.ts:281` — existing `migrateRoomV3toV4` (the pattern to mirror).
- `packages/world/src/scenes/serialize.ts:340` — `migrateToV4` chain.
- `packages/world/src/scenes/migration.test.ts` — existing test patterns to mirror.
- `packages/world/rooms/*.json` — sample on-disk room documents that must migrate.

## Files to Modify
- `packages/world/src/scenes/commands.ts` — change `schemaVersion: 4` literal to `5`; add `layoutName?: string` field to `RoomDocument`.
- `packages/world/src/scenes/serialize.ts` — add a `SerializedRoomV5` type, add `migrateRoomV4toV5`, update / wrap the master migrator (`migrateToV4` can become `migrateToV5` or you can add a separate `migrateToV5(scene)` that calls `migrateToV4` first then upgrades to v5).
- `packages/world/src/scenes/migration.test.ts` — add a v4→v5 test.

## Requirements
1. Update `RoomDocument`:
   ```
   schemaVersion: 5;
   layoutName?: string;
   ```
2. Add `SerializedRoomV5` mirroring `SerializedRoomV4` plus `layoutName?: string`.
3. Add `migrateRoomV4toV5(doc: SerializedRoomV4): SerializedRoomV5` that copies all fields, bumps the version, and leaves `layoutName` undefined.
4. Update / extend the master migration chain so any historical version (v1, v2, v3, v4) deserialized via `deserializeScene` ultimately becomes v5. The simplest path: keep `migrateToV4` as-is, then introduce `migrateToV5(scene) = migrateRoomV4toV5(migrateToV4(scene))`. Update consumers to call `migrateToV5`.
5. Update `deserializeScene` (or a thin wrapper) so it accepts and validates v5 documents (allow `layoutName: string | undefined`).
6. Update all call sites that currently call `migrateToV4` — search the world + studio packages.
7. Migration test: feed in an existing v4 document fixture; assert the output is v5, has `layoutName` undefined, and all commands are preserved.

## Acceptance Criteria
- Every existing room JSON in `packages/world/rooms/` loads via the deserialization path and emerges as v5 with `layoutName: undefined`.
- New unit test in `migration.test.ts` for v4 → v5.
- Existing migration tests still pass.
- `pnpm -C packages/world test` green.
- TypeScript compile clean across both `packages/world` and `packages/studio` (since studio imports `RoomDocument`).

## Implementation Notes
- Don't break old in-flight v3/v2/v1 migrations — they chain through `migrateToV4` first.
- The studio's `useRoomDocument.ts` writes `schemaVersion: 4` somewhere on save — find it and update to 5. Search `schemaVersion: 4` and `schemaVersion(): 4` across both packages.
- Find every `migrateToV4` call site:
  ```
  grep -rn "migrateToV4" packages/
  ```
  Replace with `migrateToV5` once it exists. Keep the old export available if other tests rely on it, but the production load path should land at v5.
