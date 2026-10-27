# Task 10: Scenario 1 Playwright Spec — Walk-off-and-Respawn Corridor

## Objective

Write `tests/playwright/scenario-corridor.spec.ts`: a bot in `linear-walk` mode walks along the 2x1x8 corridor, falls off the far end, triggers the dual-gate respawn rule, and returns to the spawn point. Assert position milestones, velocity vectors at key moments, and capture 3 committed keyframe PNGs.

This spec exercises the **real shared production movement path** — the bot's direction is issued as `walk({x:0,z:1})` through the `CharacterMovement` interface (via the `linear-walk` mode and `BotDriver`). The same interface governs the human player. There is no store-injection shortcut or synthetic position mutation.

## Context

**Quick Context:**
- The scenario-corridor map is committed by task-06 (`packages/world/maps/scenario-corridor.json`).
- The `linear-walk` bot mode (task-04) calls `walk(dir)` on the shared `CharacterMovement` interface (task-03). That interface applies physics, gravity, and the dual-gate respawn rule. The test exercises that full production path.
- The dual-gate respawn rule fires when `velY <= -MAX_FALL_VELOCITY AND hasFloorUnderneath === false`. These conditions are met when the bot walks off the corridor's far end — it is exactly what this spec asserts.
- Pattern reference: `tests/playwright/debug-character-grounded.spec.ts` — store injection, `waitForFunction`, numeric assertions.
- Motion helpers (from task-09): `waitForBotCondition`, `captureMotionKeyframe`.

## Requirements

### Setup sequence

1. Navigate to `/#debug` and wait for canvas ready (`waitForCanvasReady`).
2. Load the `scenario-corridor` map via the Debug Map Picker or a window hook (`__OFFICE_STORE__.setState` to inject `worldMap` pointing to the corridor).
3. Set bot count to 1 via `__OFFICE_BOTS__.setCount(1)`.
4. Configure bot-0 in `linear-walk` mode with direction `{x:0, z:1}`:
   ```ts
   // This triggers BotDriver.setModeWithConfig('linear-walk', { direction: {x:0,z:1} })
   // which routes through CharacterMovement.walk({x:0,z:1}) each tick.
   await page.evaluate(() =>
     window.__OFFICE_BOTS__.setLinearWalkDir(0, { x: 0, z: 1 })
   );
   ```
5. Respawn all bots at the scenario's spawn point via `__OFFICE_BOTS__.respawnAll()`.

**Why this is the real movement path:** `setLinearWalkDir` calls `setModeWithConfig('linear-walk', ...)`. Each `BotDriver.tick()` thereafter calls `linearWalkStrategy.computeIntent()` → returns `{x:0,z:1}` → `BotDriver` calls `this.movement.walk({x:0,z:1}, yaw)` → `BotCharacterMovement` runs the full physics step (gravity, collision resolution, floor probe) → result includes `velY` and `hasFloorUnderneath` → `BotDriver` checks `shouldRespawnFalling(velY, hasFloorUnderneath)`. This is the same code path a human player's forward key would trigger.

### Assertion sequence

**Phase 1 — Settled on platform:**
```ts
// Wait for bot to settle on platform top (pos.y ≈ 2.5 ± 0.2)
await waitForBotCondition(page, botId, (pos, vel) =>
  Math.abs(pos.y - 2.5) < 0.3 && Math.abs(vel.y) < 0.05
, 10_000);
// Keyframe 1: on-platform walking
await captureMotionKeyframe(page, 'scenario-corridor/ideal/keyframe-01-on-platform.png', { committed: true });
```

**Phase 2 — Walking along corridor (the CharacterMovement walk() verb in action):**
```ts
// Assert z increases over 3 s — the walk() verb is producing real movement
const startZ = await getBotZ(page, botId);
await page.waitForTimeout(3_000);
const midZ = await getBotZ(page, botId);
expect(midZ).toBeGreaterThan(startZ + 1.0); // moved at least 1 m in +Z
```

**Phase 3 — Fall detected (velocity vector assertion — dual-gate trigger):**
```ts
// Wait for vel.y <= -MAX_FALL_VELOCITY (8 m/s downward).
// This is the velY value from CharacterMoveResult.velY, broadcast as
// the player's vel.y in the store. The dual-gate respawn will fire
// when this AND hasFloorUnderneath===false hold simultaneously.
await waitForBotCondition(page, botId, (pos, vel) => vel.y <= -8, 10_000);
// Keyframe 2: mid-fall
await captureMotionKeyframe(page, 'scenario-corridor/ideal/keyframe-02-falling.png', { committed: true });
```

**Phase 4 — Respawn fires (dual-gate rule wired through CharacterMovement):**
```ts
// Wait for bot to return near spawn (pos.z < 2 — back at near end of corridor)
await waitForBotCondition(page, botId, (pos) => pos.z < 2 && pos.y > 2.0, 8_000);
// Settle after respawn
await waitForBotCondition(page, botId, (pos, vel) =>
  Math.abs(pos.y - 2.5) < 0.3 && Math.abs(vel.y) < 0.05
, 5_000);
// Keyframe 3: post-respawn settled
await captureMotionKeyframe(page, 'scenario-corridor/ideal/keyframe-03-respawned.png', { committed: true });
```

**Final numeric assertions:**
```ts
const finalState = await getBotState(page, botId);
expect(Math.abs(finalState.pos.y - 2.5)).toBeLessThan(0.3); // on platform
expect(finalState.pos.z).toBeLessThan(4); // near spawn end
```

### Helper functions (inline in spec or imported from motion-helpers)

```ts
async function getBotState(page: Page, botId: string) {
  return page.evaluate((id) => {
    const state = window.__OFFICE_STORE__.getState();
    const p = state.players[id];
    return { pos: p.pos, vel: p.vel };
  }, botId);
}
async function getBotZ(page: Page, botId: string): Promise<number> {
  return (await getBotState(page, botId)).pos.z;
}
```

### Video (if spike concluded viable)

If task-02 concluded that fuzzy video comparison is viable: also record a video of the full run and assert `compareVideoKeyframes` returns `passed: true`. If task-02 concluded not viable: skip video — numeric + keyframe assertions are the committed gate.

## Existing Code References
- `tests/playwright/debug-character-grounded.spec.ts` — reference for store injection and numeric waitForFunction
- `tests/playwright/helpers.ts` — `waitForCanvasReady`
- `tests/playwright/motion-helpers.ts` — `waitForBotCondition`, `captureMotionKeyframe` (from task-09)
- `tests/playwright/motion-baselines/scenario-corridor/manifest.json` — assertion thresholds
- `packages/world/src/physics/character-movement.ts` — `CharacterMoveResult` fields (velY, hasFloorUnderneath) that drive the respawn the spec asserts

## Implementation Details

- `test.setTimeout(90_000)` — the full corridor walk + fall + respawn may take up to 30 s in CI.
- The bot ID: check how `__OFFICE_BOTS__` exposes bot player IDs. Likely `bot-001` for the first bot — confirm at runtime with `__OFFICE_STORE__.getState().players` keys.
- **Do not** inject `worldObjects` via store for this scenario — load the committed map instead (the PRD explicitly requires the real authoring pipeline).
- Keyframe PNG names must exactly match the `manifest.json` `filename` fields from task-09.
- First run: generate the keyframes by running `pnpm exec playwright test tests/playwright/scenario-corridor.spec.ts --update-snapshots`. Review each PNG. Commit the `ideal/` PNGs.
- Subsequent runs: the PNGs are diffed against committed ideals at `maxDiffPixelRatio: 0.02`.
- TDD does not apply to Playwright specs — the spec itself IS the test.
- The `vel.y <= -8` assertion (Phase 3) is specifically testing that `CharacterMoveResult.velY` (negative and falling) is being broadcast correctly through the bot's `setSelfPosition` call. If this assertion is never reached, it means the dual-gate respawn fired too early (before reaching terminal fall velocity) — which would itself be a physics regression worth investigating.

## Acceptance Criteria

- [ ] `tests/playwright/scenario-corridor.spec.ts` exists
- [ ] Setup calls `setLinearWalkDir(0, {x:0,z:1})` — confirming the real CharacterMovement walk() path is exercised
- [ ] Phase 1 assertion: bot.pos.y within 0.3 of 2.5 when settled on platform
- [ ] Phase 2 assertion: bot.pos.z increases by at least 1 m over 3 s (walk() verb produces movement)
- [ ] Phase 3 assertion (VECTOR): `vel.y <= -8` detected during fall — velocity from CharacterMoveResult.velY is broadcast
- [ ] Phase 4 assertion: bot.pos returns near spawn (z < 2, y > 2) within 8 s of fall — dual-gate respawn fired
- [ ] 3 keyframe PNGs captured and committed to `tests/playwright/motion-baselines/scenario-corridor/ideal/`
- [ ] `pnpm exec playwright test tests/playwright/scenario-corridor.spec.ts` passes
- [ ] `pnpm exec playwright test tests/playwright/mugshot-*` still passes (physics change regression check)
- [ ] `pnpm exec playwright test tests/playwright/character-on-surface.spec.ts` still passes

## Dependencies
- Depends on: task-01 (dual-gate rule), task-03 (CharacterMovement interface — the real movement path this spec exercises), task-04 (linear-walk mode — the intent source), task-06 (corridor map), task-09 (motion harness)
- Blocks: None
