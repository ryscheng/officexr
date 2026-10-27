---
name: project-object-capabilities
description: Active PRD for object capabilities (tiling, gravity, snap, optimization) — discovery phase in progress as of 2026-05-16
metadata:
  type: project
---

Working on a PRD to introduce per-kind capability flags (tiling axes, gravity, optimization) plus snap/tiling-tool changes.

**GENERATE phase complete (updated 2026-05-17).** Tasks written to `tasks/` (12 task files: task-00 through task-11 + updated-prd.md + shared-context.md + README.md).

**Why:** The room editor previously treated everything as 2×2×2 cubes; now KayKit furniture/prototype/restaurant objects are placed, which have very different shapes and shouldn't all be tileable or snap the same way. Additionally, all "cube" identifiers were misleading because the system places generic world objects.

**Decisions made (answers from user):**
1. optimization = scaffold only (field + UI, renderer ignores it with TODO comment)
2. block category = all-axes tileable; all others = non-tileable; gravity off; optimization 'none'
3. voxelSize changes to 0.5 (was cubeSize=2); existing positions ×4 in v3→v4 room migration
4. schemaVersion bumped to 4; loaders migrate on load; room JSON files re-saved; op: 'placeCube' → 'placeObject' in v4
5. Snap to face of nearest tileable object; fallback 0.5m grid
6. X/Y/Z keyboard shortcuts to switch next tiling axis
7. 3D DirectionGizmo renderer primitive (cone + cylinder)
8. Gravity at placement only, then static
9. task-00 added: pure rename refactor — CubeKindEntry→WorldObjectKind, PlaceCubeCommand→PlaceObjectCommand, CUBE_SIZE→VOXEL_SIZE, cubeSize→voxelSize, cube-kinds-schema.ts→world-object-kinds-schema.ts, cube-catalog.ts→object-kind-catalog.ts, KindEditorPanel→ObjectKindEditorPanel, /api/cube-kinds→/api/world-object-kinds

**Dependency chain:** task-00 → task-01 → task-02 → task-03 → task-04 → {task-05, task-06, task-08} → {task-09, task-10} → task-11. task-07 depends only on task-01.

**How to apply:** This PRD is fully implemented in tasks/. When the build pipeline runs, it will pick up the 12 task files. task-00 must run first (rename only, no TDD needed).
