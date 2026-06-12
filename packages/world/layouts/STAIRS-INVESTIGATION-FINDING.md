# Stairs Collider Investigation — Finding

**Date:** 2026-06-11  
**Investigator:** Task 05 (automated code audit)  
**Status:** Complete — chosen path documented below

---

## 1. What We Looked At

### `prototype_primitive_stairs` kind definition

From `packages/world/world-object-kinds.json`:

```json
{
  "id": "prototype_primitive_stairs",
  "gltfPath": "/models/prototype/KayKit_Prototype_Bits_1.1_FREE/Assets/gltf/Primitive_Stairs.gltf",
  "dimensions": { "width": 4, "height": 4.0, "depth": 4 },
  "localAABB": {
    "min": { "x": -2, "y": 0, "z": -2 },
    "max": { "x": 2, "y": 4, "z": 2 }
  }
}
```

**AABB:** 4 m × 4 m × 4 m bounding box.

### `Primitive_Stairs.gltf` mesh geometry (binary audit)

The GLB contains **one mesh node** (`Cube.16426`) with **one primitive**, **112 vertices**, and **204 indices (68 triangles)**. There are no sub-meshes, no separate nodes per step — the entire staircase is a single merged geometry chunk.

Step shape in local GLTF space (X is the run axis, Y is the rise axis):

| Step | X range | Y top | Rise | Run |
|------|---------|-------|------|-----|
| 1    | 1.5 → 2.0 | 0.5 m | 0.5 m | 0.5 m |
| 2    | 1.0 → 1.5 | 1.0 m | 0.5 m | 0.5 m |
| 3    | 0.5 → 1.0 | 1.5 m | 0.5 m | 0.5 m |
| 4    | 0.0 → 0.5 | 2.0 m | 0.5 m | 0.5 m |
| 5    | -0.5 → 0.0 | 2.5 m | 0.5 m | 0.5 m |
| 6    | -1.0 → -0.5 | 3.0 m | 0.5 m | 0.5 m |
| 7    | -1.5 → -1.0 | 3.5 m | 0.5 m | 0.5 m |
| 8    | -2.0 → -1.5 | 4.0 m | 0.5 m | 0.5 m |

The Z axis spans the full depth (−2 to +2 m) on every step — the staircase is 4 m deep.

The staircase ascends in the **−X direction** (walking from x=+2 toward x=−2 raises Y from 0 to 4 m).

---

## 2. `MapColliders` Collider Construction

`MapColliders.tsx` emits **exactly one `CuboidCollider` per placed object** using
`geometry.worldAABB(inst.position, inst.kindId)`. For any object, the AABB is
derived from `localAABB` anchored at `voxelPosition × voxelSize`.

For `prototype_primitive_stairs` placed at voxel `[0,0,0]` with `voxelSize=0.5`:

```
worldAABB.min = [0, 0, 0]
worldAABB.max = [4, 4, 4]   (local span 4×4×4 m)
```

**Result: one opaque 4×4×4 m box.** The character hits the front face (x=4) and
is blocked — there is no step topology for Rapier to climb.

`BotPhysicsWorld.syncCubes()` takes the same `worldObjectsToCuboids` path and
produces the same single cuboid. Bots see the same wall.

---

## 3. Climbability Assessment

### Path A — `prototype_primitive_stairs` as-is

**NOT CLIMBABLE.** Single AABB cuboid = a solid wall 4 m tall. The character
cannot enter the footprint, let alone climb. Evidence: code path analysis
(`MapColliders.tsx` lines 42–57, `worldObjectsToCuboids` in `rules.ts`
lines 129–165).

### Character physics constants (for step-height math)

| Constant | Value | Source |
|----------|-------|--------|
| `charRadius` (DEFAULT) | 0.4 m | `DEFAULT_WORLD_SETTINGS` in `@officexr/sdk` |
| `BODY_Y` (bot body center) | 0.9 m | `BotPhysicsWorld.ts:18` |
| Character feet level (`BODY_Y - charRadius`) | 0.5 m | derived |
| `enableSnapToGround` | 0.3 m | `BotPhysicsWorld.ts:203` |
| `CHARACTER_CONTROLLER_SKIN` | 0.0001 m | `rules.ts:39` |
| Step rise (Primitive_Stairs) | 0.5 m | binary audit above |

### Path B — Compound per-step cuboids in `MapColliders`

If `MapColliders` emitted 8 individual step-shaped cuboids instead of one bounding box, the character would "see" a staircase topology in Rapier rather than a wall.

Step vs. ball geometry: the ball bottom lands at y = 0.5 m (= `BODY_Y - charRadius`). Step 1's top face is also at y = 0.5 m. The step corner is at (x = 1.5, y = 0.5). When the ball center is at x = 1.5 + 0.4 = 1.9, y = 0.9, the ball exactly touches the step corner (distance 0.4 m = radius). Rapier's KCC resolves the ball upward over the corner because the curved surface can slide over the step edge — the ball does not bottom-out on the vertical step face.

**Assessment:** Likely climbable under compound cuboid colliders, but the 0.5 m step / 0.4 m radius is borderline. Empirical confirmation would require running the bot against the geometry. The code-path analysis is favourable: the ball geometry allows corner-climbing for step heights ≤ charRadius, and the step is *exactly* charRadius in height.

### Path C — Ascending `colored_block_blue` cubes

`colored_block_blue` is 2 m × 2 m × 2 m. At `cubeSize=2`, a one-step-per-voxel
stack produces 2 m steps — an order of magnitude above what Rapier's KCC can
handle for a 0.4 m ball. **NOT CLIMBABLE.**

Even at the bake script's `voxelSize=0.5`, the smallest possible cube step is
0.5 m (one voxel ≡ one block dimension unit, but a colored_block_blue
occupies 4 voxels in Y, giving 2 m steps). No available block kind produces ≤ 0.3 m steps.

---

## 4. Chosen Path: **B — Compound Per-Step Cuboids in `MapColliders`**

### Rationale

- Path A is ruled out (one wall, not steps).
- Path C is ruled out (no available block kind with small enough step height).
- Path B is the minimal honest fix: it makes the Rapier physics world look like
  a real staircase, not an opaque box. The ball-on-corner geometry favours success
  at 0.5 m steps.

### Implementation

A new field `colliderShape: 'compound-steps'` is added to the `prototype_primitive_stairs` kind definition in `world-object-kinds.json`. `MapColliders` checks for this field and, when present, emits one `CuboidCollider` per step (solid column from y=0 to step top, covering one step's X-run, full Z depth) instead of the single AABB box.

`BotPhysicsWorld.syncCubes()` uses `worldObjectsToCuboids` from `rules.ts`. That function is also extended to understand `colliderShape: 'compound-steps'` so the bot physics world mirrors the browser collider layout exactly.

**No change to `enableSnapToGround` or `charRadius`.** These are not magic offsets — the ball geometry handles the corner naturally if steps are ≤ charRadius. Increasing snapToGround to "fix" climbability would be a magic offset in disguise.

### SOLID considerations

- **OCP note (MapColliders):** Adding the `colliderShape` field dispatches to a
  new branch rather than modifying the existing single-cuboid path. This is
  open/closed: the default path (single AABB) is unchanged; the new step-column
  path is additive. A future slope kind would add another case the same way.
- **ISP note:** The `colliderShape` field is a new optional field on `WorldObjectKind`.
  Callers that don't need it (the vast majority of kinds) are unaffected; only
  `MapColliders` and `worldObjectsToCuboids` read it.

### What would remove this implementation

If Rapier ever supports `HeightField` or `TriMesh` colliders in the browser-side
`@react-three/rapier` wrapper at acceptable performance, the staircase could use
the actual GLTF mesh triangles for collision instead of approximated cuboids. That
would be exact physics, not a cuboid approximation.

### SOLID violation (Path B approximation)

This implementation introduces an approximation: the step colliders are rectangular
columns (cuboids), not the exact staircase mesh. This is a known deviation.

- **Which principle:** LSP-adjacent (the collider does not faithfully reproduce the
  visual mesh's geometry for the staircase kind).
- **Why:** Rapier's `@react-three/rapier` does not expose triangle-mesh static
  colliders in the version currently used. The cuboid-staircase approximation is
  the best available Rapier primitive.
- **What would remove it:** Upgrade to a `@react-three/rapier` version that exposes
  `<TrimeshCollider>` for static bodies, and replace the cuboid-step array with the
  actual GLTF mesh geometry.

---

## 5. Task-08 Instructions

Task-08 (stairs assets) should:

1. Author `packages/world/layouts/scenario-stairs.json` using
   `prototype_primitive_stairs` placed at voxel `[0, 0, 0]`.
2. Include a flat approach platform (`colored_block_blue`) so the bot starts
   on solid ground and walks toward the staircase.
3. The bot walks in the **−X direction** to ascend (that is the ascent direction
   per the binary audit — X decreases as Y increases).
4. Assert `bot.pos.y` increases monotonically as the bot crosses the staircase
   footprint (x from +2 toward −2).
5. Expected height at top of stairs: ≈ 4 m + character feet offset.

---

## 6. E2E Suite Note

This investigation identified a **code change to `MapColliders.tsx`** (compound
step colliders) and a corresponding change to `worldObjectsToCuboids` in
`rules.ts`. Per `CLAUDE.md`:

> Playwright e2e tests (incl. mugshot) MUST be run after any change to
> `@officexr/world` renderer logic.

Before marking task-08 complete, run:

```bash
pnpm exec playwright test tests/playwright/mugshot-*
pnpm exec playwright test tests/playwright/character-on-surface.spec.ts
```

The compound collider change only affects objects whose kind has
`colliderShape: 'compound-steps'`. Existing kinds without that field are
unchanged, so mugshot regressions are not expected — but the suite must
be run to confirm.
