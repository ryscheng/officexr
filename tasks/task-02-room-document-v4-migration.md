# Task 02: Bump RoomDocument to schemaVersion 4 and Add v3→v4 Migration

## Objective
Introduce `RoomDocument` v4 (positions ×4 to preserve world positions after `voxelSize` changes from 2 to 0.5, and the `op` string migrated from `'placeCube'` to `'placeObject'`), write a v3→v4 migration that runs on load, update the serialization layer, re-save the existing room JSON files in v4 form, and cover the migration with TDD tests.

## Context

**Quick Context:**
- The coordinate system change (task-03 sets `VOXEL_SIZE = 0.5`) means world position = `voxel × voxelSize`. An object at voxel `[4, 0, 2]` under `voxelSize=2` is at world `(8, 0, 4)` m. To preserve that world position under `voxelSize=0.5`, the voxel must become `[16, 0, 8]` (i.e. ×4).
- The rename in task-00 left the `op` string as `'placeCube'` for backward compatibility. This migration formalizes the v4 upgrade: positions ×4 AND `op: 'placeCube'` → `op: 'placeObject'`.
- Migration multiplies every `placeObject` (formerly `placeCube`) command's position triple by 4. `extrude` commands do NOT store positions — they reference a target commandId and a face. Their semantics are preserved automatically because `compileScene` re-derives positions by replaying commands.
- The migration is idempotent: a v4 document loaded again must not re-migrate.

## Requirements

1. In `packages/world/src/scenes/commands.ts`:
   - Change `RoomDocument.schemaVersion` from `3` to `4`.
   - Update `emptyRoomDocument` to emit `schemaVersion: 4`.
   - Do NOT change `SceneDocument` (v2) — it remains unchanged.

2. In `packages/world/src/scenes/serialize.ts`:
   - Add `SerializedRoomV4` type (same shape as `SerializedRoomV3` but `schemaVersion: 4` and commands use `op: 'placeObject'`).
   - Update `SerializedScene` union to include `SerializedRoomV4`.
   - Update `serializeRoom` to emit `schemaVersion: 4` and `op: 'placeObject'`.
   - Update `deserializeScene` to accept `schemaVersion: 4` (same structural check as v3).
   - Add `migrateRoomV3toV4(doc: SerializedRoomV3): SerializedRoomV4` — a pure function that:
     - Rewrites every command with `op: 'placeCube'` to `op: 'placeObject'` AND multiplies its `position` by `[x*4, y*4, z*4]`.
     - Non-`placeCube` commands (i.e. `extrude`) are passed through unchanged.
     - Sets `schemaVersion: 4` in the output.
   - Remove (or supersede) the backward-compat `placeCube → placeObject` alias added in task-00, since v4 docs no longer contain `op: 'placeCube'`.

3. In `packages/studio/src/modes/room/useRoomDocument.ts`:
   - After `deserializeScene` returns a `SerializedRoomV3`, call `migrateRoomV3toV4` before converting to `RoomDocument`.
   - `schemaVersion: 4` docs must pass through without migration.

4. In `packages/world/src/scenes/storage.ts` (wherever `deserializeRoom` / `loadRoom` is implemented):
   - Apply the same v3→v4 migration if the deserialized doc is v3.
   - Read this file before editing to understand the existing storage abstraction.

5. Re-save existing room JSON files in v4 form. The files are:
   - `packages/world/rooms/default.json`
   - `packages/world/rooms/default-v2.json`
   - `packages/world/rooms/platform.json`
   - `packages/world/rooms/meeting-room-1.json`
   - `packages/world/rooms/test-room.json`

   For each: read the current JSON, apply `migrateRoomV3toV4` if `schemaVersion === 3`, write back with `schemaVersion: 4` and all `placeCube` ops rewritten as `placeObject`. You may write a one-off migration script or do this manually — either way, commit the result.

6. Update any snapshot or fixture data in tests that hardcodes `schemaVersion: 3` room shapes or `op: 'placeCube'`.

## Existing Code References
- `packages/world/src/scenes/commands.ts` — `RoomDocument`, `emptyRoomDocument`, `PlaceObjectCommand` (renamed in task-00)
- `packages/world/src/scenes/serialize.ts` — `SerializedRoomV3`, `deserializeScene`, `serializeRoom`; backward-compat alias from task-00 lives here
- `packages/world/src/scenes/storage.ts` — room load/save storage layer (read before editing)
- `packages/studio/src/modes/room/useRoomDocument.ts` — calls `deserializeScene` and constructs `RoomDocument`
- `packages/world/rooms/*.json` — on-disk v3 room files to be migrated

## Implementation Details
- `migrateRoomV3toV4` must be a pure function exported from `serialize.ts` (or a sibling `migration.ts`). Pure = no side effects, no I/O.
- The migration transforms both `op` string (`'placeCube'` → `'placeObject'`) and `position` (×4) on the same command. It should do both in one pass.
- `extrude` commands have no position — leave them unchanged.
- Do NOT modify `MapDocumentV1` (the parent map document) — it does not store per-room positions directly.
- After task-00 added a `placeCube → placeObject` alias in the deserializer, the v4 migration supersedes it. Once all on-disk files are v4, the alias can be removed. Document this in the alias comment.

## Acceptance Criteria
- [ ] `emptyRoomDocument` returns `schemaVersion: 4`.
- [ ] `migrateRoomV3toV4` multiplies all `placeCube`/`placeObject` positions by 4, rewrites `op` to `'placeObject'`, and sets `schemaVersion: 4`.
- [ ] `migrateRoomV3toV4` is idempotent when called on a v4 document — positions must not double-multiply (either the function refuses v4 input or the caller gates on version check).
- [ ] `deserializeScene` accepts `schemaVersion: 4` without throwing.
- [ ] `useRoomDocument.loadRoom` loading a v3 JSON file produces a v4 document with positions ×4 and `op: 'placeObject'`.
- [ ] All five room JSON files on disk have `schemaVersion: 4`, `op: 'placeObject'`, and positions consistent with the ×4 migration.
- [ ] `pnpm --filter @officexr/world test` passes.
- [ ] `pnpm --filter @officexr/studio test` passes.

## TDD Mode

This task uses Test-Driven Development. Write tests BEFORE implementation.

### Test Specifications
- **Test file**: `packages/world/src/scenes/migration.test.ts` (new file)
- **Test framework**: Vitest
- **Test command**: `pnpm --filter @officexr/world test`

### Tests to Write
1. **`migrateRoomV3toV4 — multiplies all placeCube positions by 4`**: Create a v3 fixture with two `placeCube` commands at `[1, 0, 2]` and `[-3, 1, 5]`. Call the migration. Expected: `[4, 0, 8]` and `[-12, 4, 20]`.
2. **`migrateRoomV3toV4 — rewrites op from placeCube to placeObject`**: Create v3 fixture with `op: 'placeCube'`. After migration, expected: `op === 'placeObject'`.
3. **`migrateRoomV3toV4 — extrude commands pass through unchanged`**: Fixture with a `placeCube` and an `extrude`. Expected: extrude's `targetCommandId`, `face`, `count` unchanged.
4. **`migrateRoomV3toV4 — schemaVersion is 4 in output`**: Expected: `doc.schemaVersion === 4`.
5. **`migrateRoomV3toV4 — idempotence guard`**: Either pass a v4 doc and expect no change, OR expect the function to throw/reject non-v3 input — pin the chosen behavior.
6. **`deserializeScene — accepts schemaVersion 4`**: Call `deserializeScene` with a minimal v4 shape. Expected: does not throw, returns v4 doc.
7. **`round-trip: serialize v4 → deserialize v4`**: Call `serializeRoom` on a v4 doc, `JSON.parse`, then `deserializeScene`. Expected: `schemaVersion === 4`, `op === 'placeObject'`, and positions preserved.

### TDD Process
1. Write all seven tests — they should FAIL (RED) because `schemaVersion: 4` and `migrateRoomV3toV4` don't exist yet.
2. Add the migration function and update `deserializeScene` (GREEN).
3. Run `pnpm --filter @officexr/world test` and `pnpm --filter @officexr/studio test`.
4. Re-save the room JSON files and confirm tests still pass.

## Dependencies
- Depends on: task-00, task-01 (schema must include new capability fields so v4 docs that add them are still valid)
- Blocks: task-03 (global voxelSize change assumes migration exists), task-04
