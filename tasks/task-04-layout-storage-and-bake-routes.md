# Task 04: Layout storage (filesystem + localStorage) and `/api/baked-layouts` route

## Objective
Add persistence for layouts (JSON) and baked GLBs (binary). Mirror the existing room storage pattern: a filesystem and localStorage implementation behind a common interface, plus REST endpoints on the Vite dev plugin.

## Dependencies
- Task 02 (`LayoutDocument` type must exist).

## Context Files
- `tasks/shared-context.md`
- `tasks/updated-prd.md`
- `packages/world/src/scenes/storage.ts:32-41` — `SceneStorage` interface (or `SceneStorage<T>` if generic).
- `packages/world/src/scenes/filesystem-room-storage.ts` — template for filesystem implementation.
- `packages/world/src/scenes/localstorage-room-storage.ts` — template for localStorage implementation.
- `packages/world/src/scenes/filesystem-map-storage.ts` — second example of the pattern.
- `packages/world/vite-plugin-storage.ts:44-56` — current `/api/rooms` and `/api/maps` REST routes; the place to add `/api/layouts` and `/api/baked-layouts`.
- `packages/world/src/scenes/layout-document.ts` (created by Task 02) — for typing.

## Files to Create
- `packages/world/src/scenes/filesystem-layout-storage.ts`
- `packages/world/src/scenes/localstorage-layout-storage.ts`
- A `LayoutStorage` type — either generic-parameterize `SceneStorage` to take a doc type, or add a sibling `LayoutStorage` interface in `storage.ts`. Prefer generic if `SceneStorage` already has a doc type parameter; otherwise add a sibling.

## Files to Modify
- `packages/world/src/scenes/storage.ts` (export `LayoutStorage` interface or generic specialization)
- `packages/world/vite-plugin-storage.ts` — add routes:
  - `GET /api/layouts` → `{ layouts: ResourceSummary[] }`
  - `GET /api/layouts/:name` → `LayoutDocument | 404`
  - `PUT /api/layouts/:name` → `204` (body = JSON layout)
  - `DELETE /api/layouts/:name` → `204`
  - `GET /api/baked-layouts/:name` → `application/octet-stream` of the GLB, or `404`
  - `PUT /api/baked-layouts/:name` → `204` (body = binary GLB)
  - `DELETE /api/baked-layouts/:name` → `204`
- `packages/world/src/scenes/index.ts` — export the new storage classes.
- `.gitignore` (root or `packages/world/`) — add `packages/world/baked-layouts/` so generated GLBs don't get committed. Layout JSON files (`packages/world/layouts/`) SHOULD be tracked (they're authoring artifacts).

## Requirements
1. Filesystem layout storage reads/writes `packages/world/layouts/<name>.json`. Name validation uses the same `isValidSceneName` regex (`/^[A-Za-z0-9._-]+$/`).
2. localStorage layout storage uses key `officexr:layout:<name>` with an index at `officexr:layout:__index__`.
3. `/api/baked-layouts/:name` accepts only `name.glb` style names. Writes go to `packages/world/baked-layouts/<name>.glb`. Directory is created on demand.
4. Binary endpoints set `Content-Type: model/gltf-binary` on GET (or `application/octet-stream` as fallback). Accept any binary body on PUT.
5. Add an `ensureDir`-style helper that creates `packages/world/baked-layouts/` if missing.

## Acceptance Criteria
- `GET /api/layouts` returns layout names (empty list initially is fine).
- `PUT /api/layouts/foo` writes `packages/world/layouts/foo.json`; `GET` returns it.
- `PUT /api/baked-layouts/foo` writes `packages/world/baked-layouts/foo.glb`; `GET` returns it; `Content-Type` correct.
- A small storage round-trip test (in `packages/world/src/scenes/`) covers filesystem layout storage.
- `pnpm -C packages/world build` and `test` are green.

## Implementation Notes
- The vite plugin file at `packages/world/vite-plugin-storage.ts` already centralizes name validation and error responses; reuse those helpers.
- Don't change behavior of existing room/map routes.
- The `baked-layouts/` directory should NOT be checked in; ensure `.gitignore` covers it.
- Layout localStorage is rarely useful (GLBs would be huge in localStorage) — the localStorage implementation can write JSON for layouts but should refuse or no-op on baked GLBs. Keep this scope: localStorage handles layout JSON only; baked GLBs are filesystem-only.
