# Task 06: Scenario Corridor Assets (Layout -> Bake -> Room -> Map)

## Objective
Author the complete `scenario-corridor` asset chain: layout JSON -> baked GLB -> room JSON -> map JSON. The result is a committed, human-loadable map representing the 2x1x8 walk-off-and-respawn corridor.

## Context

**Quick Context:**
- Authoring pipeline: layout JSON (placeObject commands) -> `pnpm tsx packages/world/scripts/bake-layout.ts scenario-corridor` -> committed GLB -> room JSON referencing layout -> map JSON referencing room + spawn points.
- Schema reference: `packages/world/layouts/long_corridor.json` (schemaVersion 1, commands array), `packages/world/rooms/platform.json` (has layoutName), `packages/world/maps/long_corridor.json` (has rooms, spawnPoints, environment).
- Optimizer IDs confirmed in `bake-optimizers.ts`: `simplify-light` (ratio 0.75, error 0.0001), `simplify-aggressive`, `default`, `none`.
- TDD does not apply to asset authoring tasks.

## Requirements

### 1. Layout: `packages/world/layouts/scenario-corridor.json`

A 2(x) x 1(y) x 8(z) platform of `colored_block_blue`. Use voxel positions:
- x in {0, 1}, y = 0, z in {0, 1, 2, 3, 4, 5, 6, 7}
- Total: 16 placeObject commands

The cubeSize for this map will be 2 (matching the existing `long_corridor` convention), so the physical platform spans:
- World X: roughly -2 to 2 (2 cubes wide at 2 m each, centered varies by room offset)
- World Z: 0 to 16 m (8 cubes long at 2 m each)
- Top face Y: 2 m (one cube at y=0 with cubeSize=2, top = 2 m)

Set `optimizer: "simplify-light"` on the layout.

Schema (follow `long_corridor.json` exactly):
```json
{
  "schemaVersion": 1,
  "name": "scenario-corridor",
  "title": "Scenario: Walk-off-Respawn Corridor",
  "updatedAt": <current unix ms>,
  "optimizer": "simplify-light",
  "commands": [
    { "id": "place-corridor-1", "op": "placeObject", "kindId": "colored_block_blue", "position": [0, 0, 0] },
    { "id": "place-corridor-2", "op": "placeObject", "kindId": "colored_block_blue", "position": [1, 0, 0] },
    ... (16 commands total, x in {0,1} x z in {0..7})
  ]
}
```

### 2. Bake: run the bake script and commit the GLB

```bash
pnpm tsx packages/world/scripts/bake-layout.ts scenario-corridor
```

This produces `packages/world/baked-layouts/scenario-corridor.glb`. Commit this file. Verify it is non-zero bytes.

### 3. Room: `packages/world/rooms/scenario-corridor.json`

```json
{
  "schemaVersion": 5,
  "name": "scenario-corridor",
  "title": "Scenario Corridor Room",
  "updatedAt": <current unix ms>,
  "layoutName": "scenario-corridor",
  "commands": [],
  "groups": {}
}
```

### 4. Map: `packages/world/maps/scenario-corridor.json`

```json
{
  "schemaVersion": 1,
  "name": "scenario-corridor",
  "updatedAt": <current unix ms>,
  "rooms": [
    {
      "id": "room-corridor-1",
      "roomName": "scenario-corridor",
      "position": [0, 0, 0],
      "rotationY": 0
    }
  ],
  "spawnPoints": [
    {
      "id": "spawn-corridor-1",
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

Spawn point `{x:0, y:2, z:0}` is above the cube nearest origin (voxel 0,0,0 — cube top at world y=2). The character is dropped from `y + SPAWN_DROP_HEIGHT` (y=2+4=6) and falls onto the platform.

### 5. Verify human-loadability
After committing the files, the map must appear in the Debug app's Map Picker dropdown when the dev server is running. Manual verification step (not automated): open `#debug`, open Map Picker, select "scenario-corridor", confirm the 2x8 corridor platform loads and the character spawns at the near end.

## Implementation Details
- Match the existing `long_corridor.json` `schemaVersion: 1` pattern precisely — the Debug app's map loader deserializes this schema.
- The `position` field in `rooms[].position` is the room's world-space offset. `[0, 0, 0]` means the room's voxel origin aligns with world origin.
- `updatedAt` should be the current Unix timestamp in milliseconds when the file is authored.
- Do NOT hand-write the baked GLB. Run the script; commit the output.
- TDD does not apply. No unit tests needed for JSON files.

## Acceptance Criteria
- [ ] `packages/world/layouts/scenario-corridor.json` exists with exactly 16 `placeObject` commands covering x={0,1}, y=0, z={0..7}
- [ ] Layout has `optimizer: "simplify-light"` field
- [ ] `pnpm tsx packages/world/scripts/bake-layout.ts scenario-corridor` completes without error
- [ ] `packages/world/baked-layouts/scenario-corridor.glb` exists and is non-zero bytes
- [ ] `packages/world/rooms/scenario-corridor.json` exists with `layoutName: "scenario-corridor"`
- [ ] `packages/world/maps/scenario-corridor.json` exists with one room, one spawn point at `{x:0, y:2, z:0}`, and environment block
- [ ] Map appears in Debug app Map Picker (manual check or confirmed via the debug server)

## Dependencies
- Depends on: None
- Blocks: task-10 (Scenario 1 Playwright spec)
