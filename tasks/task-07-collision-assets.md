# Task 07: Scenario Collision Platform Assets (Layout -> Bake -> Room -> Map)

## Objective
Author the complete `scenario-collision` asset chain: layout JSON -> baked GLB -> room JSON -> map JSON. The result is a committed, human-loadable map representing the 4x4 flat platform for the two-bot head-on collision scenario.

## Context

**Quick Context:**
- Same authoring pipeline as task-06: layout -> bake -> room -> map.
- Schema reference: `packages/world/layouts/long_corridor.json`, `packages/world/rooms/platform.json`, `packages/world/maps/long_corridor.json`.
- This map needs two spawn points at opposite Z ends of the platform for the two bots.
- TDD does not apply to asset authoring tasks.

## Requirements

### 1. Layout: `packages/world/layouts/scenario-collision.json`

A 4(x) x 4(z) flat platform of `colored_block_blue` at y=0. Voxel positions: x in {0,1,2,3}, y=0, z in {0,1,2,3}. Total: 16 `placeObject` commands.

With cubeSize=2: platform is 8 m x 8 m, top face at world y=2.

Set `optimizer: "simplify-light"`.

```json
{
  "schemaVersion": 1,
  "name": "scenario-collision",
  "title": "Scenario: Two-Bot Head-On Collision",
  "updatedAt": <current unix ms>,
  "optimizer": "simplify-light",
  "commands": [
    { "id": "place-collision-1",  "op": "placeObject", "kindId": "colored_block_blue", "position": [0, 0, 0] },
    { "id": "place-collision-2",  "op": "placeObject", "kindId": "colored_block_blue", "position": [0, 0, 1] },
    { "id": "place-collision-3",  "op": "placeObject", "kindId": "colored_block_blue", "position": [0, 0, 2] },
    { "id": "place-collision-4",  "op": "placeObject", "kindId": "colored_block_blue", "position": [0, 0, 3] },
    { "id": "place-collision-5",  "op": "placeObject", "kindId": "colored_block_blue", "position": [1, 0, 0] },
    { "id": "place-collision-6",  "op": "placeObject", "kindId": "colored_block_blue", "position": [1, 0, 1] },
    { "id": "place-collision-7",  "op": "placeObject", "kindId": "colored_block_blue", "position": [1, 0, 2] },
    { "id": "place-collision-8",  "op": "placeObject", "kindId": "colored_block_blue", "position": [1, 0, 3] },
    { "id": "place-collision-9",  "op": "placeObject", "kindId": "colored_block_blue", "position": [2, 0, 0] },
    { "id": "place-collision-10", "op": "placeObject", "kindId": "colored_block_blue", "position": [2, 0, 1] },
    { "id": "place-collision-11", "op": "placeObject", "kindId": "colored_block_blue", "position": [2, 0, 2] },
    { "id": "place-collision-12", "op": "placeObject", "kindId": "colored_block_blue", "position": [2, 0, 3] },
    { "id": "place-collision-13", "op": "placeObject", "kindId": "colored_block_blue", "position": [3, 0, 0] },
    { "id": "place-collision-14", "op": "placeObject", "kindId": "colored_block_blue", "position": [3, 0, 1] },
    { "id": "place-collision-15", "op": "placeObject", "kindId": "colored_block_blue", "position": [3, 0, 2] },
    { "id": "place-collision-16", "op": "placeObject", "kindId": "colored_block_blue", "position": [3, 0, 3] }
  ]
}
```

### 2. Bake: run and commit

```bash
pnpm tsx packages/world/scripts/bake-layout.ts scenario-collision
```

Commit `packages/world/baked-layouts/scenario-collision.glb`.

### 3. Room: `packages/world/rooms/scenario-collision.json`

```json
{
  "schemaVersion": 5,
  "name": "scenario-collision",
  "title": "Scenario Collision Room",
  "updatedAt": <current unix ms>,
  "layoutName": "scenario-collision",
  "commands": [],
  "groups": {}
}
```

### 4. Map: `packages/world/maps/scenario-collision.json`

Two spawn points — one at the near-Z end (z=1), one at the far-Z end (z=7) — in the middle of the platform (x=4, center of the 8 m width). Both at y=2 (platform top) so the character drops from `y + SPAWN_DROP_HEIGHT`.

```json
{
  "schemaVersion": 1,
  "name": "scenario-collision",
  "updatedAt": <current unix ms>,
  "rooms": [
    {
      "id": "room-collision-1",
      "roomName": "scenario-collision",
      "position": [0, 0, 0],
      "rotationY": 0
    }
  ],
  "spawnPoints": [
    {
      "id": "spawn-collision-near",
      "position": [4, 2, 1]
    },
    {
      "id": "spawn-collision-far",
      "position": [4, 2, 7]
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

The two bots are teleported to the two spawn points at the start of the Playwright spec. The spec places bot-A at the near spawn (low Z) walking +Z, bot-B at the far spawn (high Z) walking -Z, so they converge in the center.

### 5. Verify human-loadability
After committing, the map must appear in the Debug Map Picker. Manual check: load "scenario-collision", confirm the square platform and the two spawn points.

## Implementation Details
- The 4x4 grid of 16 cubes is the minimal platform where two bots can approach, meet, and block without either falling off before contact.
- Spawn points are at y=2 (platform top); characters drop from y=6 (y + SPAWN_DROP_HEIGHT=4).
- Match schemaVersion 1 precisely. Do not invent new schema fields.
- TDD does not apply to JSON asset files.

## Acceptance Criteria
- [ ] `packages/world/layouts/scenario-collision.json` exists with exactly 16 `placeObject` commands covering x={0..3}, y=0, z={0..3}
- [ ] Layout has `optimizer: "simplify-light"`
- [ ] `pnpm tsx packages/world/scripts/bake-layout.ts scenario-collision` completes without error
- [ ] `packages/world/baked-layouts/scenario-collision.glb` exists and is non-zero bytes
- [ ] `packages/world/rooms/scenario-collision.json` exists with `layoutName: "scenario-collision"`
- [ ] `packages/world/maps/scenario-collision.json` exists with exactly 2 spawn points (near and far Z ends)
- [ ] Map appears in Debug Map Picker

## Dependencies
- Depends on: None
- Blocks: task-11 (Scenario 2 Playwright spec)
