---
name: project-jump-feature
description: Active PRD for player jump (double-jump) — GENERATE phase complete 2026-05-18; 5 task files written
metadata:
  type: project
---

Player jump feature for `@officexr/world`. Player-only (bots unchanged). Space bar edge-triggered. `isAirborne` broadcast to peers for animation.

**GENERATE phase complete (2026-05-18).** Tasks written to `tasks/` (5 task files + updated-prd.md + shared-context.md + README.md).

**Why:** PRD requested single/double-jump for local player with world-level tunables broadcast to all peers. Jump animation (`Jump_Full_Long` clip already in KayKit rigs) drives for local + peer players.

**Decisions made (from user answers):**
1. Key binding: Space bar only, edge-triggered keydown
2. Bots: do NOT jump. `BotPhysicsWorld` + bot mode strategies untouched.
3. Tunables in `WorldSettings` (broadcast): `jumpVelocity: 8`, `airControl: 0.2`, `maxJumps: 2`, `landingEaseMs: 120`. New `JumpSettings` sub-type intersected in.
4. Landing: blend out over `landingEaseMs` ms (not hard stop). `landingEaseMs: 0` = hard stop.
5. `isAirborne: boolean` added to `PlayerState` + `presence:position` NetEvent (peers see it).
6. Jump animation: `Jump_Full_Long` clip for ALL players (local + peers). `STATE_CLIPS.jumping` already existed in `Adventurer.tsx`; `motion` type extended to include `'jumping'`.
7. TDD: task-01 (types) + task-02 (schemas) are TDD with Vitest. task-03/04/05 are R3F/UI — TDD not feasible, documented in task files.

**Key codebase discoveries:**
- `Adventurer.tsx` `STATE_CLIPS.jumping = 'Jump_Full_Long'` already existed — only `motion` prop type needed extension.
- `PositionBroadcaster` builds `presence:position` events from `me.isAirborne` in store — adding the field to `PlayerState` (Task 01) + `ZPresencePosition` schema (Task 02) is sufficient; broadcaster reads it automatically.
- `applyRemotePosition` signature change is breaking — all call sites must be audited (grep `applyRemotePosition\|setSelfPosition`).
- `isAirborneRef` (a `MutableRefObject<boolean>`) is threaded from `Scene.tsx` to both `SceneFrame` and `Players` to avoid React re-renders on every jump/land.

**Dependency chain:** task-01 → task-02 → {task-03, task-04}; task-03 → task-04 (for `isAirborneRef` wiring in `Scene.tsx`); task-01 → task-05 (parallel with 03/04).

**Stale files in tasks/ from previous run:** `task-03-world-scene-frame-jump-logic.md` and `task-04-studio-jump-panel.md` are marked SUPERSEDED and should be deleted.
