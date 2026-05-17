# Object Capabilities, Tiling Axis Control, Snap Redesign & Grid Migration

## Feature Summary

This initiative introduces per-kind capability flags (`tilingAxes`, `gravity`, `optimization`) to the object catalog, migrates the room coordinate system from a 2 m voxel grid to a 0.5 m grid (schema v3 → v4), generalizes the tile tool's fixed X→Z→Y axis order to be per-kind configurable, adds non-tileable snap-to-face behavior, gravity-at-placement drop, a 3D direction gizmo, and a scaffold for future renderer optimization modes.

A prerequisite rename refactor (task-00) removes all misleading "cube" identifiers (e.g. `CubeKindEntry`, `PlaceCubeCommand`, `CUBE_SIZE`) and replaces them with accurate names (`WorldObjectKind`, `PlaceObjectCommand`, `VOXEL_SIZE`) before any capability work begins.

## Task List

| # | File | Description | TDD |
|---|------|-------------|-----|
| 00 | `task-00-rename-cube-kind-to-world-object-kind.md` | Pure rename: `CubeKindEntry` → `WorldObjectKind`, `CUBE_SIZE` → `VOXEL_SIZE`, file renames, etc. | No |
| 01 | `task-01-extend-cube-kind-entry-schema.md` | Add `tilingAxes`, `gravity`, `optimization` to `WorldObjectKind`; extend `normalizeKind` | Yes |
| 02 | `task-02-room-document-v4-migration.md` | Bump `RoomDocument` to v4; migrate positions ×4 + `op: 'placeCube'` → `'placeObject'`; re-save room JSON files | Yes |
| 03 | `task-03-replace-hardcoded-cubesize.md` | Change `VOXEL_SIZE` to 0.5; remove local literals in 4 files | No |
| 04 | `task-04-per-object-snap-step-and-occupancy.md` | `computeTileStep`; update snap/tile helpers; multi-voxel occupancy | Yes |
| 05 | `task-05-snap-non-tileable-to-nearest-face.md` | `snapToNearestTileableFace` in `roomSnap.ts` | Yes |
| 06 | `task-06-drop-to-floor-gravity-placement.md` | `dropToFloor` pure function; wire into Add/Tile placement | Yes |
| 07 | `task-07-kind-editor-panel-capability-sections.md` | Tiling / Gravity / Optimization sections in `ObjectKindEditorPanel` | No |
| 08 | `task-08-generalize-tiling-state-machine.md` | Extract `tileStateMachine.ts`; per-kind axis order | Yes (pure parts) |
| 09 | `task-09-xyz-keyboard-axis-switch.md` | X/Y/Z key handling for axis switching + hint UI | No |
| 10 | `task-10-direction-gizmo-renderer-primitive.md` | `<DirectionGizmo>` in renderer package + canvas wiring | No |
| 11 | `task-11-integration-lint-and-build-verification.md` | Full lint/build/test pass; fix any remaining issues | — |

## Dependency Graph

```
task-00
├── task-01
│   ├── task-02
│   │   └── task-03
│   │       ├── task-04
│   │       │   ├── task-05
│   │       │   ├── task-06
│   │       │   └── task-08
│   │       │       ├── task-09
│   │       │       └── task-10
│   │       └── task-06
│   ├── task-07
│   └── task-08
│       ├── task-09
│       └── task-10

All → task-11
```

### Dependency summary (blocks notation)

- **task-00** → blocks task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09, task-10, task-11
- **task-01** → blocks task-02, task-04, task-05, task-06, task-07, task-08
- **task-02** → blocks task-03, task-04
- **task-03** → blocks task-04, task-05, task-06
- **task-04** → blocks task-05, task-06, task-08
- **task-05** → blocks task-11
- **task-06** → blocks task-11
- **task-07** → blocks task-11
- **task-08** → blocks task-09, task-10
- **task-09** → blocks task-11
- **task-10** → blocks task-11
- **task-11** → nothing (final task)

## Parallelism Opportunities

- **task-00** has no dependencies — start here first.
- **task-01** is the only blocker after task-00; start it immediately.
- **task-03** only depends on task-02; it can proceed in parallel with task-04's planning.
- **task-07** depends only on task-01 — can run in parallel with tasks 02/03.
- **task-05** and **task-06** can run in parallel with each other after their shared dependencies (01, 03, 04) are done.
- **task-09** and **task-10** can run in parallel after task-08.

## How to Use These Files

Each `task-*.md` file is a self-contained prompt for an AI task-implementer agent. Feed the task file (and `shared-context.md`) to the agent; it has everything it needs.

**After a task is implemented and merged, delete its `.md` file.** When all task files are deleted, the feature is complete.

## Open Questions / Decisions Already Made

All questions from `planning-questions.md` have been answered. Specifically:
- **Rename**: All generic "cube" identifiers renamed to "world-object-kind" equivalents (task-00).
- **Optimization**: Scaffold only — `optimization` field persists, renderer does not act on it.
- **Migration defaults**: `block` category = all-axes tileable; all other categories = non-tileable. Gravity off. Optimization 'none'. Applied in `normalizeKind`, not in JSON.
- **Tile step for large objects**: Minimum tile step = object's bounding-box dimension on that axis.
- **Coordinate system**: `voxelSize` changes to 0.5; existing positions ×4 in v3→v4 migration; `op: 'placeCube'` → `'placeObject'` also in that migration.
- **Non-tileable snap**: Snap to face of nearest tileable object; fallback 0.5 m grid.
- **Axis switch UX**: X/Y/Z keyboard shortcuts.
- **Arrow indicator**: 3D `<DirectionGizmo>` renderer primitive.
- **Gravity**: At placement only, then static.
- **TDD**: Yes for pure-function tasks (01, 02, 04, 05, 06, 08); No for rename/UI/rendering tasks (00, 07, 09, 10).
