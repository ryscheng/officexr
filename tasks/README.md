# Motion Regression Suite — Task Plan

Character-movement scenario tests: walk-off-respawn, two-bot collision, stairs climb.

These task files are prompts for AI agents. Delete each file after the task is completed.
When all active task files are deleted, the feature is complete.

---

## Active Tasks (12 tasks)

| Task | File | Description |
|------|------|-------------|
| 01 | task-01-fall-respawn-rule.md | Dual-gate fall-respawn rule in rules.ts [TDD] |
| 02 | task-02-video-comparison-spike.md | Fuzzy video comparison investigation |
| 03 | task-03-shared-locomotion-interface.md | CharacterMovement intent-command interface (walk/run/stop verbs) [TDD] |
| 04 | task-04-linear-walk-bot-mode.md | linear-walk bot mode + window hook [TDD] |
| 05 | task-05-stairs-investigation.md | Stairs collider investigation [GATING] |
| 06 | task-06-corridor-assets.md | Corridor layout->bake->room->map |
| 07 | task-07-collision-assets.md | Collision platform layout->bake->room->map |
| 08 | task-08-stairs-assets.md | Stairs layout->bake->room->map |
| 09 | task-09-motion-baseline-harness.md | Motion-baseline artifact harness |
| 10 | task-10-scenario-corridor-spec.md | Scenario 1 Playwright spec |
| 11 | task-11-scenario-collision-spec.md | Scenario 2 Playwright spec |
| 12 | task-12-scenario-stairs-spec.md | Scenario 3 Playwright spec |

Note: Files task-01-respawn-rule.md through task-08-collision-spec.md (without the new descriptive suffixes) are stale placeholders from the discovery phase — ignore them.

---

## Dependency Graph

```
01 (respawn rule)         -- no deps
02 (video spike)          -- no deps
05 (stairs investigation) -- no deps
06 (corridor assets)      -- no deps
07 (collision assets)     -- no deps
09 (motion harness)       -- no deps (fleshes out task-02 stubs)

03 (locomotion interface)  -- depends 01
04 (linear-walk mode)      -- depends 03
08 (stairs assets)         -- depends 05

10 (corridor spec)         -- depends 01, 03, 04, 06, 09
11 (collision spec)        -- depends 01, 03, 04, 07, 09
12 (stairs spec)           -- depends 01, 03, 04, 05, 08, 09
```

## Parallel groups

**Wave 1 (all independent, start in parallel):** 01, 02, 05, 06, 07, 09

**Wave 2 (after their deps):**
- 03 after 01
- 08 after 05

**Wave 3:**
- 04 after 03

**Wave 4 (final scenario specs):**
- 10 after 01+03+04+06+09
- 11 after 01+03+04+07+09
- 12 after 01+03+04+05+08+09

---

## Key references
- `tasks/updated-prd.md` — authoritative spec with all user decisions
- `tasks/shared-context.md` — tech stack, test infra, conventions, key files
- `CLAUDE.md` — repo guardrails (SOLID, DIP greps, honest physics, renderer rules)
- `tests/playwright/debug-character-grounded.spec.ts` — reference Playwright pattern
- `packages/world/src/physics/rules.ts` — shared physics constants (task 01 extends this)
