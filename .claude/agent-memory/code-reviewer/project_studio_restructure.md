---
name: project-studio-restructure
description: In-flight 15-task studio multi-editor restructure plan, started 2026-05-13
metadata:
  type: project
---

A 15-task restructure of `@officexr/studio` is underway on branch
`ravenac95/officexr-studio`. Plan lives at
`/home/vagrant/.claude/plans/we-are-creating-the-zany-bear.md`.

**Why:** Studio today has 3 modes (Scenes / Characters / Debug) with the
Scenes editor being too CAD-heavy for authors and no way to compose
multiple rooms. The restructure splits it into 5 purpose-built editors
(Map / Room / Object / Character / Debug) and introduces a v3 Room
document + v1 Map document so rooms can be reused via per-instance
placement.

**How to apply:** Each task lands as one commit with build + tests +
code-reviewer green before moving on. When reviewing a task, check:

1. The plan file's `### Task N` section for the exact deliverables.
2. That earlier tasks' work hasn't regressed — e.g. Task 1 keeps
   `SceneDocument` (v2) as a deprecated alias so the existing Scenes
   editor compiles for one more task; Task 6 retires it. The plan is
   designed so the codebase is shippable at every boundary.
3. The decisions in `## Architectural decisions (locked)` are
   non-negotiable per the plan — flag any deviation. Notable ones:
   quarter-turn rotationY only (not free yaw), voxel coords for room
   instances, world coords for spawns, no react-router-dom, groups are
   selection-not-compile concern.

Reviewed tasks (write report at `tasks/review-task-NN.md`):
- Task 1 (data schemas + migration): reviewed 2026-05-13 — no Criticals,
  9 Minors mostly about migrator hardening and undocumented decisions.
