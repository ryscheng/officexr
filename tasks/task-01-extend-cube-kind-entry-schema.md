# Task 01: Extend WorldObjectKind Schema with Capability Fields

## Objective
Add `tilingAxes`, `gravity`, and `optimization` capability fields to `WorldObjectKind`, wire them through `normalizeKind` and `WORLD_OBJECT_KIND_DEFAULTS`, and write tests that cover normalization, default rules, and round-trip.

## Context

**Quick Context:**
- `WorldObjectKind` is the canonical per-kind type (renamed from `CubeKindEntry` in task-00). `WORLD_OBJECT_KIND_DEFAULTS` and `normalizeKind` in `world-object-kinds-schema.ts` are the correct extension points — they normalize missing fields when loading JSON from disk.
- Migration defaults: `category === 'block'` → all-axes tileable; all other categories → non-tileable. Gravity and optimization both default to off/`'none'` for all categories.
- The `optimization` field is scaffolded only: the enum persists but `ObjectInstances.tsx` does not act on it. Leave a `TODO` comment there.

## Requirements

1. Add the following fields to `WorldObjectKind`:
   ```ts
   tilingAxes: { x: boolean; y: boolean; z: boolean };
   gravity: boolean;
   optimization: 'none' | 'static-batch' | 'frustum-cull';
   ```

2. Export an `OptimizationMode` type alias for `'none' | 'static-batch' | 'frustum-cull'` from `world-object-kinds-schema.ts`.

3. Extend `WORLD_OBJECT_KIND_DEFAULTS` with:
   ```ts
   tilingAxes: { x: false, y: false, z: false }   // non-tileable baseline
   gravity: false
   optimization: 'none' as OptimizationMode
   ```
   The block-category override is applied in `normalizeKind`, not as a global default (because the default depends on the entry's own `category` field).

4. Extend `normalizeKind` to:
   - Read `k.tilingAxes` if present (validate each sub-field is boolean).
   - If `k.tilingAxes` is absent or invalid, apply: `category === 'block'` → `{ x: true, y: true, z: true }`, else `{ x: false, y: false, z: false }`.
   - Read `k.gravity` (boolean, default `false`).
   - Read `k.optimization` (validate it is one of the three enum values, default `'none'`).

5. Add a `// OCP: optimization enum — any new variant added here will produce a compile error in the renderer switch` comment in `world-object-kinds-schema.ts` near the `OptimizationMode` type.

6. In `packages/world/src/renderer/ObjectInstances.tsx`, locate the per-kind rendering logic and add:
   ```ts
   // TODO(task-01): kind.optimization is read but not yet acted on.
   // A future PR should implement 'static-batch' (merge geometry) and
   // 'frustum-cull' (set mesh.frustumCulled = true) paths here.
   // Scaffolding per updated-prd.md "Out of Scope".
   ```
   Do NOT change rendering behavior.

## Existing Code References
- `packages/world/src/scenes/world-object-kinds-schema.ts` — `WorldObjectKind`, `WORLD_OBJECT_KIND_DEFAULTS`, `normalizeKind` (renamed in task-00; read it entirely before editing)
- `packages/world/src/renderer/ObjectInstances.tsx` — for the TODO comment placement

## Implementation Details
- Keep `normalizeKind` as a single function — do not split into sub-functions unless there is a clear SRP reason.
- The category-conditional default for `tilingAxes` lives inside `normalizeKind`, computed after the category field is resolved.
- `world-object-kinds.json` and `world-object-kinds.default.json` are NOT modified — the defaulting is purely in-memory via `normalizeKind`.
- TypeScript `const` assertion on `WORLD_OBJECT_KIND_DEFAULTS` must remain valid; the new fields should be typed inline or you may relax the `as const` on the new fields if needed (the existing fields use `as string | null` casts for nullable fields).

## Acceptance Criteria
- [ ] `WorldObjectKind` has `tilingAxes`, `gravity`, and `optimization` fields with the correct types.
- [ ] `normalizeKind` on a raw `{ id, label, gltfPath, swatch }` object with no capability fields and `category: 'block'` produces `tilingAxes: { x: true, y: true, z: true }`, `gravity: false`, `optimization: 'none'`.
- [ ] `normalizeKind` on the same object with `category: 'furniture'` produces `tilingAxes: { x: false, y: false, z: false }`.
- [ ] `normalizeKind` on an object with explicit `tilingAxes: { x: true, y: false, z: true }` preserves those values regardless of category.
- [ ] `normalizeKind` on an object with `optimization: 'static-batch'` preserves it; `optimization: 'invalid-value'` falls back to `'none'`.
- [ ] `validateWorldObjectKindCatalog` round-trips an existing catalog JSON (the bundled default at `world-object-kinds.default.json`) without throwing, even though that JSON has no capability fields.
- [ ] `pnpm --filter @officexr/world test` passes.
- [ ] `pnpm --filter @officexr/world build` type-checks without errors.

## TDD Mode

This task uses Test-Driven Development. Write tests BEFORE implementation.

### Test Specifications
- **Test file**: `packages/world/src/scenes/world-object-kinds-schema.test.ts` (new file)
- **Test framework**: Vitest
- **Test command**: `pnpm --filter @officexr/world test`

### Tests to Write
1. **`normalizeKind — block category defaults all axes tileable`**: Pass a minimal object with `category: 'block'` and no `tilingAxes` field. Expected: `tilingAxes = { x: true, y: true, z: true }`.
2. **`normalizeKind — non-block category defaults all axes non-tileable`**: Pass minimal objects for `'furniture'`, `'prototype'`, `'restaurant'`. Expected: `tilingAxes = { x: false, y: false, z: false }` for all.
3. **`normalizeKind — explicit tilingAxes respected regardless of category`**: Pass `category: 'furniture'` with `tilingAxes: { x: true, y: false, z: true }`. Expected: values preserved.
4. **`normalizeKind — gravity defaults false`**: Pass any minimal object without `gravity`. Expected: `gravity === false`.
5. **`normalizeKind — explicit gravity: true respected`**: Pass object with `gravity: true`. Expected: `gravity === true`.
6. **`normalizeKind — optimization defaults 'none'`**: Pass object without `optimization`. Expected: `optimization === 'none'`.
7. **`normalizeKind — valid optimization values preserved`**: Pass `optimization: 'static-batch'` and `optimization: 'frustum-cull'`. Expected: preserved.
8. **`normalizeKind — invalid optimization falls back to 'none'`**: Pass `optimization: 'whatever'`. Expected: `optimization === 'none'`.
9. **`validateWorldObjectKindCatalog — round-trip with bundled default`**: Import `defaultCatalogJson` and call `validateWorldObjectKindCatalog`; verify it does not throw and returns a catalog with `kinds.length > 0`, every kind having `tilingAxes`, `gravity`, `optimization`.

### TDD Process
1. Write all nine tests — they should all **FAIL** (RED) because the fields don't exist yet.
2. Add the fields to `WorldObjectKind` and extend `normalizeKind` / `WORLD_OBJECT_KIND_DEFAULTS` to make them pass (GREEN).
3. Run `pnpm --filter @officexr/world test` to confirm.
4. Verify no type errors with `pnpm --filter @officexr/world build`.

## SOLID Notes
- **OCP**: The `OptimizationMode` enum table is explicitly designed so that adding a new variant without handling it in a downstream switch produces a compile error — this is the intended fail-fast extension point.
- **SRP**: `normalizeKind` owns normalization; `ObjectInstances.tsx` owns rendering. The TODO comment makes the future coupling point explicit.
- **DIP**: `world-object-kinds-schema.ts` has no imports from THREE or React. Keep it that way.

## Dependencies
- Depends on: task-00
- Blocks: task-02, task-04, task-05, task-06, task-07, task-08
