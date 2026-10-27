# Task 08: Scenario Stairs Assets (Layout -> Bake -> Room -> Map)

## Objective
Author the complete `scenario-stairs` asset chain: layout JSON -> baked GLB -> room JSON -> map JSON. The geometry used (real `prototype_primitive_stairs` or ascending `colored_block_blue` cubes) is determined by the finding in task-05. Read `packages/world/layouts/STAIRS-INVESTIGATION-FINDING.md` first.

## Context

**Quick Context:**
- This task depends on task-05's investigation finding. Do NOT start until that finding document exists.
- Same authoring pipeline: layout -> bake -> room -> map.
- The stairs scenario needs: a flat base platform for the character to walk FROM, the stair geometry (real or simulated), and a flat top landing platform for the character to arrive AT.
- TDD does not apply to asset authoring tasks.

## Requirements

### Step 0 — Read the finding
Open `packages/world/layouts/STAIRS-INVESTIGATION-FINDING.md`. Note the chosen path (A/B/C) and the specific geometry to use.

### Step 1 — Layout: `packages/world/layouts/scenario-stairs.json`

The layout must include:
1. A **base platform** (flat, at y=0) — e.g., 2(x) x 2(z) of `colored_block_blue` at z=0..1.
2. The **stair geometry** — per the finding:
   - Path A or B: `prototype_primitive_stairs` placed at x=0..1, y=0, z=2..3 (or similar positioning such that the character walks from the base platform onto the stairs).
   - Path C (ascending cubes): place `colored_block_blue` at ascending voxel Y positions, e.g.:
     - `{x:0, y:0, z:2}`, `{x:1, y:0, z:2}` (step 1, same height as base)
     - `{x:0, y:1, z:3}`, `{x:1, y:1, z:3}` (step 2, one cube up)
     - `{x:0, y:2, z:4}`, `{x:1, y:2, z:4}` (step 3, two cubes up)
3. A **top landing** (flat, at the top Y of the stairs) — e.g., 2x2 at the highest y, z beyond the stairs.

Set `optimizer: "simplify-light"`.

Compute the exact top landing Y from the geometry. With cubeSize=2 and voxel y=2: top face = 2*2 + 2 = 6 m above world origin. Document this in a comment field or in the manifest.

### Step 2 — Bake

```bash
pnpm tsx packages/world/scripts/bake-layout.ts scenario-stairs
```

Commit `packages/world/baked-layouts/scenario-stairs.glb`.

### Step 3 — Room: `packages/world/rooms/scenario-stairs.json`

```json
{
  "schemaVersion": 5,
  "name": "scenario-stairs",
  "title": "Scenario Stairs Room",
  "updatedAt": <current unix ms>,
  "layoutName": "scenario-stairs",
  "commands": [],
  "groups": {}
}
```

### Step 4 — Map: `packages/world/maps/scenario-stairs.json`

Spawn point: at the base platform, facing the stairs. With the geometry above: `{x:0, y:2, z:0}` (above the first base cube, top at y=2).

```json
{
  "schemaVersion": 1,
  "name": "scenario-stairs",
  "updatedAt": <current unix ms>,
  "rooms": [
    {
      "id": "room-stairs-1",
      "roomName": "scenario-stairs",
      "position": [0, 0, 0],
      "rotationY": 0
    }
  ],
  "spawnPoints": [
    {
      "id": "spawn-stairs-base",
      "position": [0, 2, 0]
    }
  ],
  "environment": {
    "sun": {
      "positionX": 20,
      "positionY": 40,
      "positionZ": 20,
      "color": "#ffffff",
      "intensity": 1.4
    },
    "sky": null,
    "stars": null,
    "hdri": null,
    "ambientIntensity": 0.15
  }
}
```

### Step 5 — Document expected top height
In the map file or a companion `scenario-stairs-meta.json`, record:
- `baseY`: world Y of the base platform top face (e.g. 2.0 m)
- `expectedTopY`: world Y of the top landing top face (computed from geometry)
- `stairGeometryPath`: "A", "B", or "C" (from investigation finding)

Task-12 (the Playwright spec) reads this to know what `bot.pos.y` to assert at the top.

## Implementation Details
- If using ascending cubes (path C): with cubeSize=2, voxel y=N gives top face at `N*2 + 2` m. Three steps at y={0,1,2} give tops at {2, 4, 6} m. The snap-to-ground range (0.3 m) is less than the 2 m step height — the bot will NOT step up via snap. The Rapier character controller's built-in step-height parameter may need adjustment, OR the cubes must be spaced such that stepping is via the controller's `maxSlopeClimbAngle` (ramp-like). Investigate this as part of authoring and document what works.
- If using path A/B (real stairs): the staircase kind has its own GLB geometry — placing it at the right voxel coordinates determines whether the character walks up naturally. Test in Debug mode manually.
- TDD does not apply to JSON asset files.

## Acceptance Criteria
- [ ] `packages/world/layouts/STAIRS-INVESTIGATION-FINDING.md` has been read and the geometry choice is documented in `scenario-stairs.json`'s title/comments
- [ ] `packages/world/layouts/scenario-stairs.json` exists with base platform + stair geometry + top landing
- [ ] Layout has `optimizer: "simplify-light"`
- [ ] `pnpm tsx packages/world/scripts/bake-layout.ts scenario-stairs` completes without error
- [ ] `packages/world/baked-layouts/scenario-stairs.glb` exists and is non-zero bytes
- [ ] `packages/world/rooms/scenario-stairs.json` exists with `layoutName: "scenario-stairs"`
- [ ] `packages/world/maps/scenario-stairs.json` exists with one spawn at the base
- [ ] Expected top Y is documented (in map file or meta file) for task-12 to use
- [ ] Map appears in Debug Map Picker

## Dependencies
- Depends on: task-05 (stairs investigation — geometry choice)
- Blocks: task-12 (Scenario 3 Playwright spec)
