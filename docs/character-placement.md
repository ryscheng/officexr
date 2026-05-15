# Character placement: how a character ends up standing on a cube

This is the load-bearing math + responsibility split for putting a
character's visible feet on a physics surface. Read this when:

- A character renders with feet inside (or floating above) the floor.
- You're adding a new character rig and need to know what the model
  must comply with.
- You're touching `Players.tsx`, `Adventurer.tsx`, `SceneFrame.tsx`,
  or the body-collider geometry in `WorldSettings`.

## The transform chain

For one frame of one character, world Y of the visible feet is the
sum of:

```
world feet Y
  = body root Y                       (Rapier, driven by SceneFrame)
  + wrapper group local Y             (Players.tsx, physics anchor)
  + inner ref local Y                 (Adventurer.tsx, model anchor)
  + bind-pose minimum mesh Y          (built into the GLB)
```

Each summand is owned by exactly one file. Read the chain top-to-
bottom and the responsibility is clear.

### 1. Body root Y — `SceneFrame.tsx`

The Rapier kinematic body translates the body root each frame. The
character controller resolves `ball_bottom = body_root_y + BODY_Y -
charRadius = body_root_y + 0.5` against any cube top it sees.

With a controller penetration skin of `0.01` (from
`world.createCharacterController(0.01)`), the body root settles at
`cube_top_y - 0.5 + 0.01`. For a cube whose top is at `y=2`, that's
`y=1.51`. This is the same for every character — the body collider
geometry is shared across rigs.

### 2. Wrapper group offset — `Players.tsx`

The visible mesh is wrapped in a group with local Y = `BODY_Y -
charRadius = 0.5`. That places the wrapper's local y=0 at the body
ball's bottom — i.e., the surface the controller thinks the
character is standing on. From the wrapper's perspective, "y=0 is
the floor."

### 3. Inner ref offset — `Adventurer.tsx`

This is the per-character correction. Different rigs author their
GLBs with the model origin at different positions: KayKit puts it
near the feet, Mixamo puts it AT the feet, others might put it at
the navel. We need a way to ask "for THIS rig, where is the
bottom of the visible mesh in bind pose?" and snap the model down
by that amount so its lowest visible vertex lands at the wrapper's
y=0.

**The correct API is `SkinnedMesh.computeBoundingBox()`**, not
`Box3.setFromObject()`. Here's why:

- For a static `Mesh`, the renderer draws
  `geometry.attributes.position` transformed by `mesh.matrixWorld`,
  so `geometry.boundingBox` reflects exactly what you see on
  screen.
- For a `SkinnedMesh`, the vertex shader applies a per-vertex
  weighted sum of bone transforms. The static
  `geometry.boundingBox` is in **mesh-local "T-pose" space** and
  bears no resemblance to where the rendered vertices actually
  end up after skinning.
- `Box3.setFromObject` uses `geometry.boundingBox` for both — so
  for a character GLB it tells you the **authored** extent, not
  the **bind-pose rendered** extent. The two happen to match if
  the rig was authored bind-pose-aligned, but that's a coincidence
  per-character, not a guarantee.
- `SkinnedMesh.computeBoundingBox()` walks every vertex through
  the bone bind transforms (matching exactly what the GPU does)
  and writes the world-space rendered extent to
  `skin.boundingBox`. That's what we want.

The Adventurer measures the bbox once per clone, traversing the
scene and unioning `skin.boundingBox` for each `SkinnedMesh` it
finds (falling back to `geometry.boundingBox` for any static
meshes mixed in). The cloned scene is unparented at measurement
time so "world space" == "scene-parent space" == "innerRef's
parent's local space" — perfect for setting
`innerRef.position.y = -box.min.y`.

### 4. Bind-pose mesh Y — the GLB

The model itself contributes whatever its lowest skinned vertex
ends up at after bind transforms. We're at the mercy of the
artist's authoring, which is fine because step 3 measures and
compensates for it.

## Composed math

With the four offsets composed, a character standing on a cube
whose top is at y=2 has its lowest visible vertex at:

```
  1.51 (body root) + 0.5 (wrapper) + (-box.min.y) (inner ref) + box.min.y (mesh) = 2.01
```

That's 1 cm above the cube top — the character-controller's
penetration-prevention skin. The visible mesh sits cleanly on the
cube surface for any character regardless of rig conventions.

## Diagnostic surfaces

- **`window.__OFFICE_MESH_DEBUG__`** — published by Adventurer
  whenever a fresh clone is anchored. Carries `minY` (the measured
  bind-pose bottom), `maxY` (the top, ≈ character height), and
  `offset` (what we passed to innerRef's `position-y`). Tests and
  the standing-validation probe at
  `docs/standing-validation/single-cube.png` assert these are
  finite and roughly sane.
- **Mugshot mode** (`#mugshot/<CharacterName>`) — interactive
  per-character visual check. Cycle N/E/S/W cardinal angles, tune
  distance / viewport / ambient fill. The Y slider is a **live
  diagnostic only**: it does not flow into the export because
  doing so would let the human "cheat" the placement test by
  baking a manual lift into the baseline.
- **Mugshot baselines** —
  `tests/playwright/mugshot-baselines/<Character>/`. PNGs +
  manifest captured by the in-app Export button (Barbarian only).
  Pinned manifest schema (`schemaVersion: 2`) deliberately omits
  Y; the test reproduces at the system's default Y so the baseline
  preserves whatever the placement chain currently produces.

## Adding a new character

1. Drop the new GLB into `/public/models/characters/`.
2. Add the name to `CHARACTERS` in
   `packages/world/src/characters/registry.ts`.
3. Open `#mugshot/<NewName>`. Visually verify feet sit on cube
   tops in all 4 cardinal angles. If they don't, the rig has an
   unusual skeleton-vs-mesh relationship and we'd need to inspect
   `__OFFICE_MESH_DEBUG__` — but for any conventional
   humanoid-rig GLB the chain above handles it without per-rig
   tuning.
4. Click Export to produce a baseline set, drop into
   `tests/playwright/mugshot-baselines/<NewName>/`, commit. The
   `mugshot-baseline-compare.spec.ts` spec picks it up
   automatically (it iterates the CHARACTERS array, skipping any
   character without a baseline directory).

## What NOT to do

- Don't hardcode per-character Y offsets in `Adventurer.tsx`. If
  the rig has weird geometry, fix the rig OR extend the
  measurement; don't add a lookup table. The math above
  generalizes precisely because no character-specific knowledge
  lives in the renderer.
- Don't `setSelfPosition({...prev, y: 1.5})` from outside
  SceneFrame. The auto-warp will catch it, but you've encoded a
  magic constant that fights the controller. Let the physics
  decide; tune the body geometry in `WorldSettings` if the
  controller produces a wrong settle point.
- Don't put `yOffset` in the mugshot manifest. The whole point of
  that test is to surface the bug class "character renders below
  the surface". Baking a corrective Y into the baseline encodes
  the bug as expected behavior.
