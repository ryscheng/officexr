# Implementation Notes — Tasks 1–6

Decisions made during implementation that weren't in the plan, plus
the deliberate scope cuts.

## Task 1 — Schemas + migration script
- **`ambientIntensity` added to `MapEnvironment`** that wasn't in the
  plan's listed fields. Reason: the existing renderer's
  `LightingPanel` already has an `ambientIntensity` knob that we'll
  promote to the map document in Task 13. Adding the field to the
  schema now avoids a v2 bump later.
- **`RoomGroup.id` is duplicated** as both the `Record<string, RoomGroup>`
  key and a field on the value. The duplication is intentional — a
  group passed by reference (e.g. into the inspector) needs to know
  its own identity. Documented inline at `commands.ts`.
- **Migration script does NOT delete `packages/world/scenes/`** even
  though the plan said it should. Reason: the Vite plugin still serves
  the legacy `/api/scenes` endpoint from there for back-compat with the
  existing Scenes editor (retired in Task 5/6). Deletion is a future
  cleanup once nobody points at `/api/scenes`.

## Task 2 — Storage layer + Vite middleware unification
- **Deferred `FilesystemCatalogStorage`** to Task 3. Reason: the catalog
  schema (`CubeKindCatalogV1`) lands in Task 3, and defining the storage
  class without the typed shape would force a re-edit. The
  `/api/cube-kinds` endpoint is mounted in Task 2 as a generic
  single-document GET/PUT; Task 3 adds the typed client.
- **Legacy `vite-plugin-scene-storage.ts` shim** initially re-exported
  the new options as `SceneStoragePluginOptions`. Reviewer flagged this
  as misleading (old + new option shapes differ); the alias was dropped
  in the same task.
- **`SceneStorage` interface alias retired in Task 6** rather than
  Task 2. Reason: the existing Scenes editor still imported it through
  Task 5's renames. Once the Room editor (Task 6) switched to
  `RoomStorage` the alias became unreferenced and was removed.

## Task 3 — Catalog → JSON + ObjectInstances reads catalog
- **Material build helpers extracted to `cube-material.ts`** so they're
  unit-testable in a node environment (no WebGL). The original plan
  kept them inside `ObjectInstances.tsx`.
- **`SEAM_OVERLAP = 1.05`** stays a renderer-side constant decoupled
  from `kind.scale`. The cube GLTFs have beveled edges that need the
  overlap to hide seams; if `scale` had folded in the overlap, "1 = no
  change" would have meant 0.95× actual size which is surprising.
- **`useGLTF.preload` still loops over the bundled-default kinds** at
  module load, not the live catalog. Task 4's asset packs are
  preloaded lazily by `useGLTF` inside `KindInstanceGroup` on first
  use. Trade-off: the first cube of a freshly-installed pack causes a
  one-time GLTF load on the main thread.

## Task 4 — Asset packs
- **Catalog is committed; binaries are gitignored.** Repo size stays
  small (~80 KB cube-kinds.json vs ~40 MB unzipped GLTFs). Fresh
  clones need `pnpm asset-packs:install` to populate the binaries.
- **`unzip` system command** used for extraction. Pure-Node zip parsers
  exist but add a dep for a one-shot install script. `unzip` is
  available on macOS / Linux / WSL / Git Bash on Windows.
- **Filename collision behavior** of `slugify`: lowercases, so
  `Chair_A.gltf` and `chair_a.gltf` would silently dedup. Not triggered
  by current packs; flagged as a future-pack risk in the reviewer
  report.

## Task 5 — 5-mode routing + page shells
- **No `react-router-dom`.** The studio has 5 flat tabs, no nested
  routes; `useState<StudioMode>` + `location.hash` mirror is simpler.
- **Default landing `#map`** silently rewrites `/studio` → `/studio#map`.
  Matches the plan but worth flagging in case future deep links from
  outside the app point at `/studio` without a hash.
- **React-tree render tests skipped** for `StudioPage` because the
  studio's vitest env is node-only. The decision logic (`isStudioMode`,
  hash↔state) is covered by 9 logic-level tests in
  `__tests__/studio-mode.test.ts`. Adding `@testing-library/react` +
  jsdom for one shallow render is heavier than the value.
- **CharacterApp rename slip** — my `Edit` calls renamed
  `CharactersApp` → `CharacterApp` inside the file but I missed staging
  the file in the Task 5 commit. The committed Task 5 was technically
  broken (import vs export mismatch), but my unstaged working-tree
  edits masked it during the Task 5 verification run. Folded into the
  Task 6 commit.

## Task 7 — Ghost layer + snapping refactor
- **`PulseDriver` collocated** with `GhostLayer.tsx` rather than living
  in its own file. Reason: it's a 5-line component whose only public
  surface is "drive the shared opacity ref"; splitting it adds a
  module boundary without a test surface. The plan said
  `PulseDriver.tsx`, but a separate file is overkill.
- **Pulse-mode plumbing landed without a caller.** No tool emits pulse
  ghosts in Task 7 — that's Task 8's Delete tool. The pulse code path
  is end-to-end correct (the test for it is the visible Delete-tool
  preview when Task 8 lands).
- **Ghost meshes use raycast layer 31** to opt out of the snap
  raycaster (which runs on the default layer 0). Reviewer flagged
  that the `mesh.layers.set(31)` happens in `useEffect`, leaving a
  one-frame window where the ghost is on layer 0. Acceptable for now
  — no raycast can fire before React commits the effect, since the
  events that drive raycasts are themselves dispatched between
  React's reconciliation passes.
- **`e.stopPropagation()` in the cube's `handlePointerMove`** —
  reviewer caught that without it, the floor's pointermove ran after
  the cube's and overwrote the CubeHit with a y=0 FloorHit, putting
  the Add ghost on the floor under the cube. Fix landed before commit.
- **`extractGeometryFromGltf` / `extractMaterialFromGltf` re-exported**
  from `@officexr/world/renderer` so the studio's GhostLayer and the
  canvas's CubesLayer can share one implementation. This is a
  controlled coupling: the studio is a known consumer of the
  renderer's helpers; it's not a layering violation (renderer →
  studio direction would be).
- **`SEAM_OVERLAP = 1.05` not multiplied by `kind.scale`** in the
  ghost meshes. All current kinds have `scale: 1`, so the latent bug
  hasn't been hit. Folded into the Task 11 (Object editor) backlog
  when per-kind scale starts varying.

## Task 6 — Room editor multi-select + groups
- **Pure helpers in `room-selection.ts`** drive the click semantics so
  they're testable in node. The hook (`useRoomDocument`) is a thin
  glue layer — the reviewer's first round flagged that the hook
  duplicated the helpers instead of using them; that's been fixed.
- **`groupCommands` mints id outside the updater.** Calling
  `mintGroupId()` inside `setDoc` would burn a fresh id on every dev
  StrictMode double-invoke. The validate-then-mint-then-update pattern
  also makes the return value reflect the real outcome rather than
  always being `null`.
- **`deleteSelection` reads selection from the closure**, not from
  inside a `setSelectionState` updater. Functional updaters must be
  pure; reading + calling `deleteCommandsInternal` from inside one
  double-fires under StrictMode.
- **`SceneStorage` interface + `FilesystemSceneStorage` +
  `LocalStorageSceneStorage` are still exported** from
  `packages/world/src/scenes/index.ts`. Nothing in the studio uses
  them anymore (the Room editor reads through `FilesystemRoomStorage`,
  which migrates via `migrateToV3`). Dead code, not breakage — slated
  for a future cleanup task. The plan called for retirement; deferring
  because no caller is left to fix.
- **`compileScene` widened** to accept either v2 `SceneDocument`, v3
  `RoomDocument`, or any `{ commands }`. Algorithm only reads
  `doc.commands`, so the wider type is safe. Avoids unnecessary
  duplication of the compile logic.
- **`selectionIsExactlyOneGroup` is exported but unused** — it lands
  here so Task 10's context menu ("Ungroup" gating) can call it
  without another file edit.
