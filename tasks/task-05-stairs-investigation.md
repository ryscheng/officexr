# Task 05: Stairs Collider Investigation (Gating)

## Objective
Investigate whether `prototype_primitive_stairs` produces climbable Rapier step geometry under the cuboid-AABB collider scheme in `MapColliders`. Produce an explicit written finding. If climbable, proceed with the real kind. If not, implement the minimal fix OR document and apply the ascending-cubes fallback. The finding gates task-08 (stairs asset authoring) and task-12 (stairs spec).

## Context

**Quick Context:**
- `MapColliders` creates one cuboid collider per placed object using the kind's AABB (`geometry-service.worldAABB`). For a staircase, that AABB is the bounding box of the entire GLB — an opaque rectangular block, not individual steps.
- The Rapier kinematic character controller has `enableSnapToGround(0.3)` — it can climb steps up to 0.3 m tall. With cubeSize=2, a `colored_block_blue` step height is 2 m (too tall for snap). But if cubeSize is 0.5 m (VOXEL_SIZE), steps are 0.5 m tall — still beyond 0.3 m snap.
- The investigation must go beyond the snap-height alone: the actual staircase GLB's collision geometry determines what the character "sees" in Rapier.
- `prototype_primitive_stairs` is listed in `world-object-kinds.json` and has a thumbnail; its collider geometry in the kind definition determines the AABB.

## Requirements

### Step 1 — Inspect `prototype_primitive_stairs` definition
Read `packages/world/src/world-object-kinds.json` (or wherever world object kinds are defined). Find `prototype_primitive_stairs`:
- What is its registered AABB? (width, height, depth in world units)
- Does the kind definition specify per-step sub-colliders, or just a single bounding box?
- What GLB does it reference? Does that GLB have multiple sub-meshes (one per step) or one merged mesh?

### Step 2 — Check `MapColliders` collider construction
Read the `MapColliders` component (likely `packages/world/src/renderer/` or nearby). Confirm:
- Does it emit one cuboid per placed object (bounding-box only)?
- Or does it support compound/per-sub-mesh colliders for specific kinds?
- If compound colliders are not supported: the entire staircase is an opaque box — a character walking into it is blocked at the face, not guided up the steps.

### Step 3 — Load the stairs in Debug mode and observe
If possible via an automated check (or describe the manual observation steps):
1. Place one `prototype_primitive_stairs` object in a test map.
2. Run a bot in `linear-walk` mode walking toward it.
3. Observe: does `bot.pos.y` increase as the bot crosses the staircase footprint, or does the bot stop at the near face (blocked by the AABB wall)?

### Step 4 — Explicit written finding (REQUIRED)
Create `packages/world/layouts/STAIRS-INVESTIGATION-FINDING.md` with:
- Summary of collider geometry observed
- Test result: climbable / not climbable, with evidence (measured bot Y values or code-path analysis)
- Chosen path: (A) use `prototype_primitive_stairs` as-is, (B) fix the collider scheme, or (C) fall back to ascending cubes
- If (C): document the reasoning inline with: which principle is bent, why the real kind cannot be made to work at this time, and what would need to change to use it properly

### Step 5 — Implement the chosen path (or document it for task-08)
- **(A) Climbable**: no collider fix needed. Task-08 will author a stairs layout using `prototype_primitive_stairs`.
- **(B) Fix collider scheme**: implement the minimal change to `MapColliders` to emit per-step cuboids for the staircase kind. This may involve adding a `colliderShape: 'compound-steps'` field to the kind definition and handling it in `MapColliders`. Document any SOLID consideration inline.
- **(C) Ascending cubes fallback**: document the fallback geometry (e.g., `colored_block_blue` at voxel positions `{x:0, y:0, z:0}`, `{x:0, y:1, z:1}`, `{x:0, y:2, z:2}` for a 3-step ascent with cubeSize=2). Task-08 will use this geometry. The finding doc must explain why the real kind is excluded.

## Existing Code References
- `packages/world/src/world-object-kinds.json` — `prototype_primitive_stairs` definition
- The `MapColliders` component — find via grep: `grep -rn "MapColliders" packages/world/src/renderer/`
- `packages/world/src/app/geometry-service.ts` — `worldAABB` method (how AABB is computed per kind)
- `packages/world/src/bot/BotPhysicsWorld.ts` — `syncCubes` uses `worldObjectsToCuboids` with AABB lookup — same geometry path bots use

## Implementation Details
- TDD does not apply to investigation spikes. This task is research + a written finding + (optionally) a minimal code fix.
- If implementing a collider fix (path B): it touches the renderer (`MapColliders`). Run the mugshot + character-on-surface suites after any such change.
- The written finding must be honest: do not claim `prototype_primitive_stairs` works if the bot Y data shows otherwise.

## Acceptance Criteria
- [ ] `packages/world/layouts/STAIRS-INVESTIGATION-FINDING.md` exists with concrete evidence of climbability
- [ ] Finding states unambiguously: climbable (A), fixed (B), or falling back to ascending cubes (C)
- [ ] If path (B): `MapColliders` change is implemented, tested, and the e2e suite still passes
- [ ] If path (C): reasoning is documented inline with the SOLID principle being bent and the removal path
- [ ] Task-08 can reference this finding to know which geometry to author
- [ ] If any renderer code changed: `pnpm exec playwright test tests/playwright/mugshot-*` passes
- [ ] If any renderer code changed: `pnpm exec playwright test tests/playwright/character-on-surface.spec.ts` passes

## Dependencies
- Depends on: None
- Blocks: task-08 (stairs asset authoring), task-12 (stairs Playwright spec)
