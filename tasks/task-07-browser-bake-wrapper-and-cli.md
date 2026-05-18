# Task 07: Browser bake wrapper and Node CLI

## Objective
Thin wrappers around `bakeLayout`: one for the browser (uses `fetch` and posts to `/api/baked-layouts/:name`), one for Node (uses `fs.promises.readFile` and writes to disk directly). The Node script mirrors `scripts/bake-kind-dimensions.ts`.

## Dependencies
- Task 04 (endpoints exist).
- Task 05 (`bakeLayout` exists).
- Task 06 (`BakeRegistry.publish` interface defined).

## Context Files
- `tasks/shared-context.md`
- `tasks/updated-prd.md`
- `packages/world/scripts/bake-kind-dimensions.ts` — the Node CLI pattern.
- `packages/world/src/app/bake-service.ts` — existing browser-callable bake.
- `packages/world/src/renderer/ObjectInstances.tsx` — for how the runtime resolves `kind.gltfPath` URLs today (relative to the studio public dir).
- `packages/world/src/scenes/filesystem-catalog-storage.ts` — for how the catalog is loaded by Node scripts.

## Files to Create
- `packages/world/src/app/layout-bake-service-browser.ts`
- `packages/world/scripts/bake-layout.ts`

## Files to Modify
- `packages/world/src/app/index.ts` — export the browser wrapper.
- `packages/world/package.json` — if a new script entry is desired (e.g. `"bake-layout": "tsx scripts/bake-layout.ts"`).

## Requirements
1. **Browser wrapper** (`layout-bake-service-browser.ts`):
   - Exports `createBrowserBakeDeps(catalog): BakeDeps`.
   - `kindLookup` reads from the in-memory catalog passed in.
   - `gltfLoader(url)` uses `fetch(url).then(r => r.arrayBuffer()).then(b => new Uint8Array(b))`.
   - `publish(layoutName, glb)` does `fetch('/api/baked-layouts/' + encodeURIComponent(layoutName), { method: 'PUT', headers: { 'Content-Type': 'model/gltf-binary' }, body: glb })`.
2. **Node CLI** (`scripts/bake-layout.ts`):
   - Usage: `pnpm tsx packages/world/scripts/bake-layout.ts <layoutName>` (or `--all` to bake every layout in `packages/world/layouts/`).
   - Reads the catalog from `packages/world/world-object-kinds.json` (or `.default.json` if missing).
   - Reads the layout JSON from `packages/world/layouts/<name>.json`.
   - `gltfLoader(url)` resolves `url` against the studio public dir (`packages/studio/public${url}` for `url` starting with `/models/...`) and uses `fs.promises.readFile`.
   - Writes the GLB to `packages/world/baked-layouts/<name>.glb` directly via `fs.promises.writeFile`.
   - Exits 0 on success, 1 with a message on failure.

## Acceptance Criteria
- `pnpm tsx packages/world/scripts/bake-layout.ts <existing-layout-fixture-name>` produces a valid GLB at `packages/world/baked-layouts/<name>.glb`.
- The browser wrapper's `publish` round-trips a GLB via the Vite endpoint (verifiable in the layout view at runtime).
- Both scripts/files type-check.

## Implementation Notes
- For the Node CLI, the path resolver assumes `kind.gltfPath` looks like `/models/blocks/...`. Strip the leading `/` and prepend `packages/studio/public/`.
- Don't import any `three` / `react` in either wrapper.
- For `--all`, log progress per layout. Continue on individual failures with a non-zero exit at the end if any failed.
- Make the script's working-directory assumption explicit by resolving paths via `path.resolve(__dirname, '../layouts/...')`.
