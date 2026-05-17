# Task 00: Rename cube-kind Identifiers to world-object-kind Across the Codebase

## Objective
Perform a pure mechanical rename of all generic "cube-kind" identifiers to "world-object-kind" equivalents so that subsequent tasks work with accurate names. No behaviour changes, no schema field additions, no value changes. After this task the codebase compiles, lints, and all existing tests pass.

## Context

**Quick Context:**
- This is a rename-only commit. The system now places generic world objects (chairs, tables, blocks, props) — not just cubes. "Cube" in identifier names that refer to the placed-object catalog concept is misleading.
- Identifiers that genuinely mean "a cube primitive mesh" (KayKit BlockBits asset names, literal 1×1×1 geometry) are NOT renamed.
- Existing room JSON files on disk use `op: "placeCube"` — leave the `op` string as-is in this task. A backward-compat alias is added in the command reader so existing files load. Task-02 will formalize the v4 schema bump and officially rewrite the `op` string on disk.

**SRP note:** Rename-only commits are explicitly separated from behaviour commits (Single Responsibility at the PR level). This task is a textbook SRP-aligned rename PR — it touches many files but changes zero runtime behaviour.

## Rename Table

| Old identifier | New identifier |
|---|---|
| `CubeKindEntry` (type) | `WorldObjectKind` |
| `CUBE_KIND_DEFAULTS` (constant) | `WORLD_OBJECT_KIND_DEFAULTS` |
| `PlaceCubeCommand` (type) | `PlaceObjectCommand` |
| `packages/world/src/scenes/cube-kinds-schema.ts` | `packages/world/src/scenes/world-object-kinds-schema.ts` |
| `packages/world/src/scenes/cube-catalog.ts` | `packages/world/src/scenes/object-kind-catalog.ts` |
| `packages/world/cube-kinds.json` | `packages/world/world-object-kinds.json` |
| `packages/world/cube-kinds.default.json` | `packages/world/world-object-kinds.default.json` |
| `/api/cube-kinds` (API route) | `/api/world-object-kinds` |
| `CUBE_SIZE` (the grid constant) | `VOXEL_SIZE` |
| `cubeSize` (the parameter name everywhere) | `voxelSize` |
| `KindEditorPanel.tsx` → `ObjectKindEditorPanel.tsx` | (see requirements below) |
| Any UI strings / JSDoc comments that say "cube" generically (not the literal mesh) | "object" |

**Do NOT rename:** KayKit asset names, literal cube mesh geometry, `cubeGeometry` for primitive shapes, `CubeCamera`, or any variable that is literally a cube (not the placed-object catalog concept).

## Requirements

### 1. Rename source files

- `packages/world/src/scenes/cube-kinds-schema.ts` → `packages/world/src/scenes/world-object-kinds-schema.ts`
- `packages/world/src/scenes/cube-catalog.ts` → `packages/world/src/scenes/object-kind-catalog.ts`
- `packages/studio/src/modes/object/KindEditorPanel.tsx` → `packages/studio/src/modes/object/ObjectKindEditorPanel.tsx`

Update every import site that references the old filenames.

### 2. Rename data files

- `packages/world/cube-kinds.json` → `packages/world/world-object-kinds.json`
- `packages/world/cube-kinds.default.json` → `packages/world/world-object-kinds.default.json`

Update all code that references these paths (JSON imports, `fs.readFile` calls, `package.json` exports if present, test fixtures that import by path).

### 3. Rename the type `CubeKindEntry` → `WorldObjectKind`

In `world-object-kinds-schema.ts` (formerly `cube-kinds-schema.ts`):
- Rename the exported type.
- Rename `CUBE_KIND_DEFAULTS` → `WORLD_OBJECT_KIND_DEFAULTS`.
- Rename the `normalizeKind` parameter type annotations where they reference `CubeKindEntry`.
- Update the `validateWorldObjectKindCatalog` function (renamed from `validateCubeKindCatalog` if it exists).

Update every import site in the codebase that imports `CubeKindEntry` or `CUBE_KIND_DEFAULTS`.

### 4. Rename the command type `PlaceCubeCommand` → `PlaceObjectCommand`

In `packages/world/src/scenes/commands.ts`:
- Rename `PlaceCubeCommand` to `PlaceObjectCommand`.
- The `op` field **value** is left as `'placeCube'` for now (task-02 will rewrite it to `'placeObject'` in the v4 migration).
- Add a deprecation comment:
  ```ts
  // op: 'placeCube' — kept as-is for on-disk v3 backward compatibility.
  // Task-02 migrates this to 'placeObject' in v4 room documents.
  ```
- Update the `SceneCommand` union where it references `PlaceCubeCommand`.
- Update all files that import `PlaceCubeCommand`.

### 5. Rename `CUBE_SIZE` / `cubeSize` → `VOXEL_SIZE` / `voxelSize`

- In `packages/world/src/renderer/config.ts`: rename `CUBE_SIZE` to `VOXEL_SIZE`. The value stays `2` — task-03 changes the value to `0.5`.
- In every file that has a local `const CUBE_SIZE = 2`: rename to `VOXEL_SIZE` (keep the value `2`).
- In every function signature that has a parameter named `cubeSize`: rename to `voxelSize`.
  - `compileScene(doc, cubeSize)` → `compileScene(doc, voxelSize)`
  - `snapToVoxel(..., cubeSize)` → `snapToVoxel(..., voxelSize)`
  - `checkMoveOccupancy(...)` — rename the parameter if present.
  - All other callers: rename the argument at the call site.
- In test fixtures that have `cubeSize: 2` as a named property: rename the property to `voxelSize` **only** if the property is defined on a type whose field is being renamed. If it is a literal object passed to a renamed function, update the call site. If it is a `WorldObjects` type field or similar SDK type, check whether that SDK type field is also being renamed (it should be — grep first).

### 6. Rename `/api/cube-kinds` route → `/api/world-object-kinds`

Search for the route handler file (likely in `packages/studio/src/` or a server package). Rename the route string. Update any client-side `fetch('/api/cube-kinds')` call sites.

### 7. Rename `KindEditorPanel` → `ObjectKindEditorPanel`

- Rename the file (done in requirement 1).
- Rename the exported React component inside the file: `KindEditorPanel` → `ObjectKindEditorPanel`.
- Update every import site.

### 8. Update UI strings and comments

- In UI-visible strings (labels, section titles, tooltips), replace generic "cube" with "object" where appropriate. For example: "Add Cube" button → "Add Object", "cube catalog" → "object catalog". Do NOT change asset-specific labels like "Cube Block" (that is a kind name, not the catalog concept).
- Update JSDoc and inline comments that describe `CubeKindEntry`, `placeCube`, `cube-kinds` generically — rewrite to use new names.

### 9. Backward-compat alias for the `op` string

Add the following alias in `packages/world/src/scenes/serialize.ts` (or wherever `deserializeScene` reads the command `op` field):

```ts
// Backward-compat: v3 room documents use op: 'placeCube'. Map to 'placeObject' on load
// so the rest of the system sees the canonical name. Task-02 formally migrates
// on-disk files to v4.
if ((cmd as any).op === 'placeCube') {
  return { ...cmd, op: 'placeObject' } as PlaceObjectCommand;
}
```

This alias means existing v3 room JSON files on disk continue to load after the rename, before task-02 re-saves them. The alias lives in the deserialization layer, not in business logic.

**Alternative (acceptable):** If the rename is done before the `op` string migration and the command type's `op` field still holds `'placeCube'`, the alias is not needed — just leave `op: 'placeCube'` as-is. Pick whichever approach creates less churn; document the choice with a comment.

## Search Commands

Run these before and after to verify completeness:

```bash
grep -rn "CubeKind" packages/
grep -rn "cube-kind" packages/
grep -rn "PlaceCubeCommand\|placeCube\b" packages/
grep -rn "cubeSize\|CUBE_SIZE" packages/
grep -rn "/api/cube-kinds" packages/
grep -rn "KindEditorPanel" packages/
```

All should return zero matches after the rename (except for the `op: 'placeCube'` deprecation comment and the backward-compat alias, which intentionally keep the old string).

## Existing Code References
- `packages/world/src/scenes/cube-kinds-schema.ts` — type, constant, normalizer (read before renaming)
- `packages/world/src/scenes/cube-catalog.ts` — catalog store (read before renaming)
- `packages/world/src/scenes/commands.ts` — `PlaceCubeCommand`, `SceneCommand` union
- `packages/world/src/scenes/serialize.ts` — deserialization + alias insertion point
- `packages/world/src/renderer/config.ts` — `CUBE_SIZE` constant
- `packages/studio/src/modes/object/KindEditorPanel.tsx` — component rename
- Any `index.ts` barrel files that re-export renamed symbols

## Implementation Details
- Use IDE rename-symbol or careful sed/find-replace. Do NOT miss re-exports in `index.ts` barrel files.
- `pnpm build` must succeed after the rename — TypeScript will catch any missed import sites.
- After renaming files, check `packages/world/package.json` `exports` field for any hardcoded paths to the renamed files and update them.
- Keep the old file names as deleted in git (do not leave empty shim files). Barrel re-exports will redirect consumers through the new names.

## Acceptance Criteria
- [ ] `grep -rn "CubeKindEntry\|CubeKind\b" packages/ | grep -v "\.md"` returns 0 matches (no non-doc code uses the old type name).
- [ ] `grep -rn "CUBE_KIND_DEFAULTS" packages/ | grep -v "\.md"` returns 0 matches.
- [ ] `grep -rn "PlaceCubeCommand" packages/ | grep -v "\.md"` returns 0 matches.
- [ ] `grep -rn "CUBE_SIZE\|cubeSize\b" packages/ | grep -v "\.md" | grep -v "// "` returns 0 matches in code (comments may retain the old name as historical context).
- [ ] `grep -rn "/api/cube-kinds" packages/ | grep -v "\.md"` returns 0 matches.
- [ ] `grep -rn "KindEditorPanel" packages/ | grep -v "ObjectKindEditorPanel" | grep -v "\.md"` returns 0 matches.
- [ ] `pnpm build` (or `pnpm --filter @officexr/world build && pnpm --filter @officexr/studio build`) succeeds without type errors.
- [ ] `pnpm --filter @officexr/world test` passes with no new failures.
- [ ] `pnpm --filter @officexr/studio test` passes with no new failures.
- [ ] `packages/world/rooms/*.json` files still load without throwing (backward-compat alias is in place, OR the `op` field is still `'placeCube'` and the type accepts it).
- [ ] No runtime behaviour change — all existing features work identically.

## TDD Mode
Not applicable. This is a pure rename refactor. Existing tests serve as the safety net and must continue to pass unchanged.

## SOLID Notes
- **SRP**: This is a rename-only PR. No behaviour changes, no schema additions. Keeping the rename separate from the capability-flag additions (task-01) and the migration (task-02) preserves clarity in git history and makes each PR reviewable in isolation.

## Dependencies
- Depends on: None
- Blocks: task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09, task-10, task-11
