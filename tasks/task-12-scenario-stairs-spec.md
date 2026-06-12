# Task 12: Scenario 3 Playwright Spec — Stairs Climb

## Objective

Write `tests/playwright/scenario-stairs.spec.ts`: a bot in `linear-walk` mode walks from the base platform up the stairs and reaches the top. Assert bot Y increases monotonically and bot reaches the expected top height. Capture 3 committed keyframe PNGs. The geometry used (real stairs or ascending cubes) is determined by task-05's finding and implemented in task-08.

The bot issues `walk(dir)` intents through the shared `CharacterMovement` interface (via the `linear-walk` mode and `BotDriver`). The stair climb is an exercise of the CharacterMovement interface's snap-to-ground and step-detection capabilities — no store-injection shortcut.

## Context

**Quick Context:**
- Read `packages/world/layouts/STAIRS-INVESTIGATION-FINDING.md` (task-05 output) before writing the spec to understand the stair geometry and expected top height.
- Read `packages/world/maps/scenario-stairs.json` (task-08 output) for the spawn point and any companion meta file documenting `expectedTopY`.
- Pattern reference: `tests/playwright/debug-character-grounded.spec.ts` + `motion-helpers.ts`.
- TDD does not apply to Playwright specs.
- The stair climb exercises `CharacterMovement.walk()` with the character controller's `enableSnapToGround` behavior — this is the real Rapier step-climbing path, not a simulated one.

## Requirements

### Step 0 — Read task-05 and task-08 outputs

Before implementing:
- Check `packages/world/layouts/STAIRS-INVESTIGATION-FINDING.md` for the geometry path (A/B/C) and `expectedTopY`.
- Check `packages/world/maps/scenario-stairs.json` or companion meta file for the spawn coordinates and `expectedTopY`.
- Adjust assertion thresholds in the spec to match the actual stair geometry.

### Setup sequence

1. Navigate to `/#debug`, wait for canvas ready.
2. Load `scenario-stairs` map.
3. Set bot count to 1 via `__OFFICE_BOTS__.setCount(1)`.
4. Configure bot-0 in `linear-walk` mode with direction toward the stairs:
   ```ts
   // Issues walk({x:0,z:1}) through CharacterMovement.walk() each BotDriver tick.
   // The CharacterMovement snap-to-ground will handle ascending the steps.
   await page.evaluate(() =>
     window.__OFFICE_BOTS__.setLinearWalkDir(0, { x: 0, z: 1 })
   );
   ```
   Adjust direction if the layout places stairs in a different direction from the spawn (check task-08 layout).
5. Respawn bot at the base spawn point. Wait for bot to settle on base platform.

### Assertion sequence

**Phase 1 — On base platform:**
```ts
const baseY = 2.5; // from manifest — top of base platform cubes (cubeSize=2, voxel y=0 → top=2)
await waitForBotCondition(page, botId, (pos, vel) =>
  Math.abs(pos.y - baseY) < 0.3 && Math.abs(vel.y) < 0.05
, 10_000);
// Keyframe 1: bot at base of stairs
await captureMotionKeyframe(page, 'scenario-stairs/ideal/keyframe-01-base.png', { committed: true });
```

**Phase 2 — Ascending (monotonic Y — walk() via CharacterMovement snap-to-ground):**
```ts
// Sample Y every 500ms for 5 s; assert it does not decrease.
// The CharacterMovement.walk() verb, combined with Rapier's enableSnapToGround,
// should step the character up each stair tread without the bot needing to
// jump or apply any special logic — snap-to-ground handles it transparently.
let prevY = await getBotY(page, botId);
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(500);
  const currY = await getBotY(page, botId);
  // Allow a 0.15 m tolerance for physics jitter at step edges
  expect(currY, `Y should not decrease during stair climb step ${i}`).toBeGreaterThan(prevY - 0.15);
  prevY = currY;
}
// Capture mid-climb keyframe once Y is clearly above base
await waitForBotCondition(page, botId, (pos) => pos.y > baseY + 0.5, 8_000);
// Keyframe 2: mid-climb
await captureMotionKeyframe(page, 'scenario-stairs/ideal/keyframe-02-mid-climb.png', { committed: true });
```

**Phase 3 — Reached top:**
```ts
// expectedTopY comes from manifest or meta file; read it here
const expectedTopY = /* from manifest, e.g. */ 6.5; // adjust per task-08 output
await waitForBotCondition(page, botId, (pos) => pos.y > expectedTopY - 0.3, 15_000);
// Keyframe 3: bot at top
await captureMotionKeyframe(page, 'scenario-stairs/ideal/keyframe-03-top.png', { committed: true });
```

**Phase 4 — No respawn during climb:**
```ts
// Verify the dual-gate respawn rule did NOT fire incorrectly during the climb.
// During stair ascent, CharacterMoveResult.velY may briefly go slightly negative
// (gravity always accumulates) but the floor probe (hasFloorUnderneath) should
// remain true as long as the bot is standing on a step. If both gates fired
// incorrectly (false-positive), the bot would have teleported back to spawn.
// pos.z > 3 confirms the bot is at the top of the stairs, not at spawn.
const finalState = await getBotState(page, botId);
expect(finalState.pos.z, 'bot should be at top of stairs, not respawned').toBeGreaterThan(3);
// pos.y should be near expected top, not near base
expect(finalState.pos.y).toBeGreaterThan(expectedTopY - 0.5);
```

### Geometry-conditional logic

Because the geometry differs by investigation path, add a clear comment:

```ts
// Geometry path: see packages/world/layouts/STAIRS-INVESTIGATION-FINDING.md
// Path A/B: prototype_primitive_stairs (real stair GLB — snap-to-ground
//   climbs the collider geometry directly)
// Path C: ascending colored_block_blue cubes (each step is a discrete cube;
//   snap-to-ground transitions the bot up each cube face)
// Either way, the CharacterMovement.walk() interface handles it the same
// way — the snap-to-ground behavior is encapsulated in BotCharacterMovement,
// not in this spec.
// expectedTopY is read from motion-baselines/scenario-stairs/manifest.json
```

## Existing Code References
- `tests/playwright/motion-helpers.ts` — `waitForBotCondition`, `captureMotionKeyframe` (task-09)
- `tests/playwright/motion-baselines/scenario-stairs/manifest.json` — `expectedTopY`, thresholds (task-09)
- `packages/world/layouts/STAIRS-INVESTIGATION-FINDING.md` — geometry path (task-05)
- `packages/world/maps/scenario-stairs.json` — spawn point, base Y (task-08)
- `packages/world/src/physics/character-movement.ts` — `CharacterMoveResult` (`hasFloorUnderneath` is the key field; a stair-climbing bug often manifests as a spurious floor-probe false-negative mid-step that triggers a wrong respawn)

## Implementation Details

- `test.setTimeout(120_000)` — stair climbing may be slow, especially with ascending-cube geometry.
- The monotonic Y assertion uses a 0.15 m tolerance for physics jitter. If the staircase is ascending cubes with 2 m voxel steps, the bot may "step up" in discrete 2 m jumps (via the character controller's snap-to-ground) — the inter-step Y may briefly dip. The 0.15 m tolerance accommodates minor jitter but not a full-step regression.
- If the bot does NOT reach the top (Y never exceeds `expectedTopY - 0.3` within the timeout), the test fails with a meaningful message naming the geometry path. This is the regression signal for the stair-climb physics.
- **Phase 4 is specifically a dual-gate respawn regression test.** The floor probe in `BotCharacterMovement.probeFloor()` must remain `true` throughout the climb. If the probe has a bug where it returns `false` while the bot is standing on a step edge (e.g., the probe fires downward from the body center rather than from the feet, and the step geometry is thin), a spurious respawn would fire. Phase 4 catches this.
- TDD does not apply to Playwright specs.

## Acceptance Criteria

- [ ] `tests/playwright/scenario-stairs.spec.ts` exists
- [ ] Setup calls `setLinearWalkDir(0, dir)` — confirming the shared CharacterMovement walk() path is exercised
- [ ] Spec references the geometry path from `STAIRS-INVESTIGATION-FINDING.md` in a comment
- [ ] Phase 2 assertion: bot Y does not decrease by more than 0.15 m between samples during ascent (snap-to-ground working through CharacterMovement)
- [ ] Phase 3 assertion: bot Y reaches within 0.3 m of `expectedTopY` from task-08 meta
- [ ] Phase 4 assertion: bot does not respawn during climb (pos.z > 3 at end) — dual-gate floor probe has no false negatives on step edges
- [ ] 3 keyframe PNGs committed to `tests/playwright/motion-baselines/scenario-stairs/ideal/`
- [ ] `pnpm exec playwright test tests/playwright/scenario-stairs.spec.ts` passes
- [ ] `pnpm exec playwright test tests/playwright/mugshot-*` still passes
- [ ] `pnpm exec playwright test tests/playwright/character-on-surface.spec.ts` still passes

## Dependencies
- Depends on: task-01 (dual-gate rule), task-03 (CharacterMovement interface — snap-to-ground and floor probe live here), task-04 (linear-walk mode), task-05 (stairs investigation), task-08 (stairs map), task-09 (motion harness)
- Blocks: None
