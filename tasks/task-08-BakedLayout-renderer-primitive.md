# Task 08: `<BakedLayout>` and `<BakedLayoutColliders>` renderer primitives

## Objective
Two new renderer primitives in `packages/world/src/renderer/`. `<BakedLayout>` loads and renders a baked GLB. `<BakedLayoutColliders>` derives static `WALL_GROUPS` cuboid colliders from the GLB's sub-meshes. Both compose into `Scene.tsx` near `<ObjectInstances>` / `<MapColliders>`.

## Dependencies
- Task 04 (endpoint serves the GLB).
- Task 06 (`BakeRegistry.awaitFresh` and `getVersion` for cache busting).
- Task 07 (browser wrapper provides the fetch/publish deps that the registry calls).

## Context Files
- `tasks/shared-context.md`
- `tasks/updated-prd.md`
- `packages/world/src/renderer/Scene.tsx:110-307` — scene root; insertion point lines 205–241.
- `packages/world/src/renderer/ObjectInstances.tsx` — pattern for using `useGLTF` (drei).
- `packages/world/src/renderer/MapColliders.tsx` — collider pattern (one fixed `RigidBody` + per-instance `<CuboidCollider>` children).
- `packages/world/src/renderer/cube-material.ts:56-79` — `extractGeometryFromGltf` / `extractMaterialFromGltf` helpers.
- `packages/world/src/physics/groups.ts` — `WALL_GROUPS`.
- `packages/world/src/renderer/index.ts` — barrel.
- `packages/world/src/app/bake-registry.ts` (Task 06) — `awaitFresh`, `getVersion`, `subscribe`.

## Files to Create
- `packages/world/src/renderer/BakedLayout.tsx`
- `packages/world/src/renderer/BakedLayoutColliders.tsx`

## Files to Modify
- `packages/world/src/renderer/Scene.tsx` — accept new optional props `bakedLayoutPath?: string`, `bakedLayoutName?: string`. When both provided, render `<BakedLayout>` + `<BakedLayoutColliders>` (next to `<ObjectInstances>` / `<MapColliders>` around lines 205–241).
- `packages/world/src/renderer/index.ts` — export the new components.

## Requirements
1. `<BakedLayout>`:
   - Props: `{ gltfPath: string; layoutName?: string; fallback?: ReactNode; materialOverride?: MaterialOverride }`.
   - Compute an effective URL by appending `?v=<version>` from `BakeRegistry.getVersion(layoutName)` so drei's `useGLTF` cache busts when a new bake lands.
   - Use `useGLTF(effectiveUrl)` inside a `<Suspense fallback={fallback}>` boundary.
   - If a load fails (network 404), trigger `BakeRegistry.awaitFresh(layoutName, deps, docFetcher)` from a `useEffect` — but only if `layoutName` is provided; otherwise just throw the error. Subscribe to the registry via `subscribe` to re-render when state transitions to `settled`. No `useRef + setStateSync` mirror pairs — use a `useSyncExternalStore`-style hook or plain `useState` + the subscribe callback.
   - Render `<primitive object={gltf.scene} />` once loaded. Apply `materialOverride` if provided (used by editor canvases).
2. `<BakedLayoutColliders>`:
   - Props: `{ gltfPath: string; layoutName?: string }`.
   - Loads the same GLB via `useGLTF`.
   - Traverses `gltf.scene` for each `Mesh`, computes its world-space AABB (use a `THREE.Box3().setFromObject(mesh)` or similar — three IS allowed here since this file is in the renderer).
   - Emits one `<CuboidCollider>` per mesh with `args={[hx, hy, hz]}` and `position={[cx, cy, cz]}`, tagged with `WALL_GROUPS`.
   - Wraps them all in a single `<RigidBody type="fixed" colliders={false}>`.
3. `Scene.tsx`:
   - Accept optional `bakedLayoutPath?: string`, `bakedLayoutName?: string`.
   - When both truthy, render the two new primitives inside `<Physics>` next to `<MapColliders>` and `<ObjectInstances>`. The `<ObjectInstances>` continues to render the room's non-layout objects (the room's commands are NOT filtered here; filtering is in the consumer that builds `worldObjects`).
4. `useGLTF.preload(effectiveUrl)` is optional — drei handles it lazily.

## Acceptance Criteria
- `pnpm -C packages/world build` green.
- `pnpm -C packages/world test` green.
- A focused Storybook-style render (manual or automated) shows the baked GLB rendering — colliders block player movement.
- Mugshot tests still pass for rooms NOT using a layout. For rooms using a layout, baselines will need re-baselining (handled in Task 12 / verification).
- `Scene.tsx`'s new props are optional and default to undefined — existing call sites compile unchanged.
- `grep -rn "useRef" packages/world/src/renderer/BakedLayout.tsx` shows no `useRef + setStateSync` mirror pair.

## Implementation Notes
- `THREE.Box3().setFromObject(mesh)` returns world-space AABB if the mesh has been added to a scene with applied transforms. If you traverse before mounting, use `mesh.geometry.boundingBox` + `mesh.matrixWorld`. Either way, `three` is allowed in this file.
- For the cache-bust query string, only append `?v=...` if the version is > 0 to avoid an extra fetch in the common "no bake yet" branch.
- For loading-fallback behavior: prefer a thin React state object `{ stage: 'loading' | 'loaded' | 'error' }` over multiple booleans, per CLAUDE.md guidance on avoiding mirror pairs.
- This task explicitly touches the renderer — re-running Playwright mugshots is required as part of acceptance. The mugshot suite re-baseline lives in Task 12; here, just confirm the suite still runs.
