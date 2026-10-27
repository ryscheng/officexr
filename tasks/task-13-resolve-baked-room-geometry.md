# Task 13: Resolve baked-layout room geometry into worldObjects (bot/headless physics)

## Objective
Make a baked-only room (one with a `layoutName` and empty `commands`) contribute its
authored geometry to the compiled `worldObjects`, so the headless `BotPhysicsWorld` (and
the `respawnThreshold` backstop) get precise per-cube colliders from the **authored layout** —
not from a store-injection hack. The renderer must keep using the optimized baked GLB for
visuals + player colliders (no double meshes / double colliders). This removes the
`__OFFICE_STORE__.setState` cube-injection that task-10 was forced to add.

## Why this exists
Modern rooms are "baked-only": geometry lives in the LAYOUT (`commands`) → baked into a single
optimized GLB → the room just references it via `layoutName` with `commands: []`.
- The local **player** gets colliders from `BakedLayoutColliders` (per-mesh AABBs of the baked GLB).
- `BotPhysicsWorld.syncCubes(state.worldObjects)` builds bot colliders from `worldObjects`, which
  `compileMap` produces from the room's **commands** — empty for baked rooms. So bots fall through.

The honest fix: when a room has no inline commands but names a layout, compile the LAYOUT's
commands into that room instance's `worldObjects`. The resulting per-cube cuboids are
geometrically consistent with the baked GLB AABBs (the bake is just a merge of the same cubes).

## Requirements

### 1. `compileMap` — optional layout resolution (opt-in, back-compatible)
File: `packages/world/src/scenes/compile-map.ts`
- Add an OPTIONAL parameter: a layout lookup, e.g. `getLayout?: (layoutName: string) => { commands: SceneCommand[] } | undefined`
  (a `CompileInput` is `SceneDocument | RoomDocument | { commands }` — a `LayoutDocument` satisfies `{ commands }`).
- For each `RoomInstance`: resolve the `RoomDocument`. If `room.commands` is non-empty, compile the room
  as today. ELSE if `room.layoutName` is set and `getLayout(room.layoutName)` returns a layout,
  compile `{ commands: layout.commands }` via `compileScene` and use those instances for this room instance.
- When `getLayout` is omitted (existing callers), behavior is IDENTICAL to today (no resolution).
- Keep id namespacing (`${ri.id}/...`), yaw rotation, and translation exactly as the current code does.
- Unit test: a map referencing a baked-only room + a provided layout yields the layout's instances;
  the same map WITHOUT the resolver yields empty (back-compat).

### 2. `room-service.compileMap` wrapper
File: `packages/world/src/app/room-service.ts`
- Thread an optional `layouts: ReadonlyMap<string, { commands: SceneCommand[] }>` (or a resolver) through
  to `compileMapRaw`, building the `getLayout` closure from it. Keep the existing signature working when
  no layouts are supplied.

### 3. Debug runtime wiring — load layouts and pass them
File: `packages/studio/src/modes/debug/useMapPicker.ts` (and whatever storage/ApplicationApi exposes layouts)
- When loading a map, also load the layouts referenced by its rooms (discover the layout storage / API the
  same way rooms are loaded — there is a layouts storage analogous to rooms; e.g. an ApplicationApi
  `listLayouts`/`loadLayout` or a `/api/layouts` storage). Build the layouts map and pass it into
  `roomService.compileMap(map, rooms, layouts)` so `setWorldObjects(...)` carries the authored geometry.
- This is the ONLY runtime caller that should opt into layout resolution. The editor paths stay unchanged.

### 4. Renderer — avoid double geometry when a baked layout is present
File: `packages/world/src/renderer/Scene.tsx`
- Today `<MapColliders>` and `<ObjectInstances>` render from `worldObjects` unconditionally, and
  `<BakedLayout>` + `<BakedLayoutColliders>` render only when `hasBaked`. With worldObjects now populated
  for baked rooms, gate `<MapColliders>` and `<ObjectInstances>` behind `!hasBaked` so a baked room renders
  ONLY the optimized baked GLB (mesh) and ONLY the baked colliders for the player — no per-cube duplicates.
- This is a strict no-op for every existing map: non-baked maps have `hasBaked === false` (unchanged), and
  today's baked maps have empty `worldObjects` so `MapColliders`/`ObjectInstances` already render nothing.
  The gate only changes the NEW (baked room + populated worldObjects) combination.
- RENDERER CHANGE → the mugshot + character-on-surface e2e suites MUST be run as part of verification.

### 5. Remove the task-10 injection workaround (follow-up, do in task-10 redo)
- Note in your report that `tests/playwright/scenario-corridor.spec.ts` should drop its
  `__OFFICE_STORE__.setState` 16-cube injection once this resolution lands, and rely on the authored map.

## Constraints (CLAUDE.md)
- `three` only inside `packages/*/renderer/**` (Scene.tsx is renderer — OK). `compile-map.ts`, `room-service.ts`
  stay headless. SDK/core DIP greps stay clean.
- No new `useRef + setStateSync` mirror pairs.
- Honest physics, no magic offsets. Bounded invariant unit tests for the compile-map resolution.
- Document any deliberate SOLID violation inline (principle / why / what-would-remove-it).

## Acceptance criteria
- `compileMap` with a layout resolver compiles baked-only rooms into real instances; without it, unchanged.
- Loading `scenario-corridor` (or `long_corridor`) in debug yields non-empty `worldObjects`, so a bot placed
  on it has a floor in `BotPhysicsWorld` WITHOUT any store injection.
- Renderer shows a single set of meshes/colliders for baked rooms (no z-fighting / double colliders).
- `pnpm --filter @officexr/world test` green; DIP greps clean.
- Mugshot + character-on-surface Playwright suites pass (no visual drift).

## Dependencies
- Depends on: task-06 (corridor assets exist to test against). Foundational for task-10/11/12 specs.
- Blocks: clean (injection-free) task-10/11/12 specs.

## Files to Modify / Context
- `packages/world/src/scenes/compile-map.ts`, `compile.ts` (CompileInput), `commands.ts` (SceneCommand)
- `packages/world/src/app/room-service.ts`
- `packages/studio/src/modes/debug/useMapPicker.ts` (+ layouts storage/ApplicationApi)
- `packages/world/src/renderer/Scene.tsx` (gate MapColliders/ObjectInstances behind `!hasBaked`)
- Context: `packages/world/src/renderer/BakedLayoutColliders.tsx`, `BotDriver.ts` (syncCubes), `layouts/scenario-corridor.json`
