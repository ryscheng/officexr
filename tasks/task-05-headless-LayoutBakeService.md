# Task 05: Headless `LayoutBakeService` using `gltf-transform`

## Objective
Build a pure, headless bake function `bakeLayout(doc, kindLookup, gltfLoader)` that merges all layout objects into a single optimized GLB. Must work in both browser and Node — no `three`, no `react`, no DOM.

## Dependencies
- Task 02 (`LayoutDocument` exists).

## Context Files
- `tasks/shared-context.md`
- `tasks/updated-prd.md`
- `packages/world/src/app/bake-service.ts` — existing headless service pattern (zero `three`, used both browser + Node).
- `packages/world/src/app/types.ts` — service interface conventions.
- `packages/world/scripts/bake-kind-dimensions.ts` — existing Node bake script (callee of bake-service).
- `packages/world/src/scenes/world-object-kinds-schema.ts` — for `WorldObjectKind`, `gltfPath`, `scale`.
- `packages/world/src/scenes/commands.ts` — `SceneCommand`, `PlaceObjectCommand`.
- `packages/world/package.json` — add deps `@gltf-transform/core`, `@gltf-transform/functions`.

## Files to Create
- `packages/world/src/app/layout-bake-service.ts`

## Files to Modify
- `packages/world/package.json` — add dependencies:
  - `@gltf-transform/core`
  - `@gltf-transform/functions`
  - (Optionally) `@gltf-transform/extensions` if needed by `join`/`flatten`.
  Use the latest stable version.
- `packages/world/src/app/index.ts` — export `bakeLayout`.

## Requirements
1. Export an async function:
   ```
   export interface KindLookup { (kindId: string): WorldObjectKind | undefined }
   export interface BakeOptions { compress?: false | 'draco' }
   export interface BakeResultBytes { glb: Uint8Array; meta: { kindCount: number; commandCount: number } }
   export async function bakeLayout(
     doc: LayoutDocument,
     kindLookup: KindLookup,
     gltfLoader: (url: string) => Promise<Uint8Array>,
     options?: BakeOptions,
   ): Promise<BakeResultBytes>
   ```
2. Implementation outline:
   - For each `placeObject` command: resolve the kind via `kindLookup`; if missing, log/throw with a clear error.
   - For each unique `kind.gltfPath`, load the bytes via `gltfLoader` (cache by URL inside the function).
   - Use `@gltf-transform/core` `WebIO` / `NodeIO`. Since we need the bake service itself to be runtime-agnostic, parse source GLBs using `WebIO` (it works in both Node 20+ and browser) — confirm at implementation time which IO class is platform-neutral; if neither is, accept an `io: IO` argument and inject it from the browser/Node wrappers.
   - Use `readBinary(bytes)` to parse each source into a `Document`.
   - Clone each instance: copy the kind's root nodes into the bake `Document`, applying the command's `position` (and any `rotationY`/`scale` if those exist on the command — check `commands.ts` for the exact shape). The voxelSize is 0.5 in v4+ rooms; positions are world coordinates directly.
   - Run `dedup()`, `weld()`, `prune()`, `join()`, `flatten()` from `@gltf-transform/functions` in that order.
   - If `options?.compress === 'draco'`, apply Draco compression (off by default — adds runtime decoder requirement).
   - Emit GLB via `writeBinary` and return.
3. NO imports from `three`, `react`, or any DOM API. Confirm with a grep at task end.
4. Errors: surface a clear message if a kind cannot be resolved, if a GLTF fails to parse, or if no commands exist.
5. Unit test: feed two distinct trivial cube GLTF fixtures (or use existing kind GLBs in `packages/studio/public/models/blocks/`); assert output has fewer primitives than the sum.

## Acceptance Criteria
- `pnpm -C packages/world test` green; includes a new test for `bakeLayout`.
- `grep -rn "from 'three'" packages/world/src/app/layout-bake-service.ts` → 0 matches.
- `grep -rn "from 'react'" packages/world/src/app/layout-bake-service.ts` → 0 matches.
- The output GLB validates as a parseable GLB when re-read by `gltf-transform`.
- TypeScript compile clean.

## Implementation Notes
- The `IO` class choice in `gltf-transform` is the main runtime question. Approach: accept an `IO` instance as an optional argument (`io?: IO`), default to `new WebIO()` if not provided. Browser/Node wrappers pass an appropriate instance. This keeps the bake service injection-friendly.
- Don't try to apply rotation if the `placeObject` command doesn't carry one — check `commands.ts` for the exact shape and only handle fields that exist.
- The bake function is pure: same input → same output (modulo gltf-transform internal IDs). Keep determinism in mind for tests.
- Document `bakeLayout` with a short JSDoc explaining its contract and zero `three`/`react` rule.
