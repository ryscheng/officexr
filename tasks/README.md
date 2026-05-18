# Tasks — Layout View & Baked-GLTF Optimization

Build pipeline tasks for adding a Layout authoring mode + `gltf-transform`-baked GLB optimization. Each task is a focused, dependency-aware unit.

## Read first

- [`shared-context.md`](./shared-context.md) — shared codebase context, constraints, patterns to reuse.
- [`updated-prd.md`](./updated-prd.md) — the feature spec the reviewer compares the implementation against.

## Tasks (in dependency order)

### Wave 1 — Schema (parallel)
- `task-01-add-isLayoutObject-to-WorldObjectKind.md` — add the boolean to kind schema.
- `task-02-define-LayoutDocument-type.md` — new doc type + serialize/deserialize.
- `task-03-RoomDocument-v4-to-v5-migration.md` — bump room schema; add `layoutName?` + migration.

### Wave 2 — Storage, service stub, palette/object-editor (parallel, depend only on Wave 1)
- `task-04-layout-storage-and-bake-routes.md` — layout & baked-GLB storage + Vite endpoints (depends on 02).
- `task-05-headless-LayoutBakeService.md` — headless bake using `gltf-transform` (depends on 02).
- `task-09-ObjectPalette-layoutFilter.md` — palette `layoutFilter` prop + Room view toggle (depends on 01).
- `task-10-object-editor-isLayoutObject-toggle.md` — kind editor checkbox (depends on 01).

### Wave 3 — Registry + bake wiring
- `task-06-bake-registry.md` — module-level debounce + cross-unmount promise (depends on 05).
- `task-07-browser-bake-wrapper-and-cli.md` — fetch wrapper + Node CLI (depends on 04, 05, 06).

### Wave 4 — Renderer primitives
- `task-08-BakedLayout-renderer-primitive.md` — `<BakedLayout>` + `<BakedLayoutColliders>` + Scene wiring (depends on 04, 06, 07).

### Wave 5 — Layout mode
- `task-11-LayoutApp-mode-and-hook.md` — `useLayoutDocument` + `LayoutApp` + router/header wiring (depends on 02, 04, 06, 07, 09, 10).

### Wave 6 — Room + Map consume baked layouts
- `task-12-Room-Map-consume-baked-layouts.md` — wire `layoutName`, Inspector field, mugshot re-baseline (depends on 03, 08, 11).
