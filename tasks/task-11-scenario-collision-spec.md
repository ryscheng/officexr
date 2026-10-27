# Task 11: Scenario 2 Playwright Spec — Two-Bot Head-On Collision

## Objective

Write `tests/playwright/scenario-collision.spec.ts`: two bots in `linear-walk` mode walk toward each other on a 4x4 platform, collide, and are blocked. Assert both bots' positions stabilize AND both velocity vectors drop to ~zero when blocked. Capture 2 committed keyframe PNGs.

Both bots issue `walk(dir)` intents through the shared `CharacterMovement` interface (via the `linear-walk` mode and `BotDriver`). This spec confirms that the collision blocking behavior works correctly through the unified movement path — not through a synthetic store shortcut.

## Context

**Quick Context:**
- The scenario-collision map is committed by task-07 (`packages/world/maps/scenario-collision.json`) with two spawn points at opposite Z ends.
- Character-vs-character collision blocking already works via `BotPhysicsWorld` peer mirrors and `progress < movementBlockThreshold`. After task-03, this remains intact — `BotCharacterMovement._step()` maps a fully-blocked step to `animState: 'idle'` and `broadcastVel: {0,0,0}`, which is what the spec asserts.
- The `linear-walk` mode (task-04) drives both bots via `walk()` on the CharacterMovement interface.
- Pattern reference: `tests/playwright/debug-character-grounded.spec.ts` + `motion-helpers.ts` (task-09).

## Requirements

### Setup sequence

1. Navigate to `/#debug`, wait for canvas ready.
2. Load `scenario-collision` map.
3. Set bot count to 2: `__OFFICE_BOTS__.setCount(2)`.
4. Configure bot-0 with `linear-walk {x:0, z:1}` (walks in +Z, starts at near-Z spawn):
   ```ts
   // Issues walk({x:0,z:1}) through CharacterMovement each BotDriver tick
   await page.evaluate(() =>
     window.__OFFICE_BOTS__.setLinearWalkDir(0, { x: 0, z: 1 })
   );
   ```
5. Configure bot-1 with `linear-walk {x:0, z:-1}` (walks in -Z, starts at far-Z spawn):
   ```ts
   // Issues walk({x:0,z:-1}) through CharacterMovement each BotDriver tick
   await page.evaluate(() =>
     window.__OFFICE_BOTS__.setLinearWalkDir(1, { x: 0, z: -1 })
   );
   ```
6. Teleport bot-0 to near-Z spawn point `{x:4, y:6, z:1}` (drop from above) and bot-1 to far-Z spawn `{x:4, y:6, z:7}`.
7. Wait for both bots to settle on platform (both `pos.y ≈ 2.5 ± 0.3`).

### Assertion sequence

**Phase 1 — Approaching (vector assertion — walk() verb is producing movement):**
```ts
// Bot-0's walk({x:0,z:1}) produces positive vel.z via CharacterMoveResult.broadcastVel
// Bot-1's walk({x:0,z:-1}) produces negative vel.z via CharacterMoveResult.broadcastVel
await waitForBotCondition(page, bot0Id, (pos, vel) => vel.z > 0.1, 5_000);
await waitForBotCondition(page, bot1Id, (pos, vel) => vel.z < -0.1, 5_000);
// Keyframe 1: both bots approaching from opposite ends
await captureMotionKeyframe(page, 'scenario-collision/ideal/keyframe-01-approaching.png', { committed: true });
```

**Phase 2 — Contact detected:**
```ts
// Wait until bots' Z positions are within 2 m of each other (contact imminent)
await page.waitForFunction(
  ([b0, b1]) => {
    const state = window.__OFFICE_STORE__.getState();
    const p0 = state.players[b0]?.pos;
    const p1 = state.players[b1]?.pos;
    if (!p0 || !p1) return false;
    return Math.abs(p0.z - p1.z) < 2.0;
  },
  [bot0Id, bot1Id],
  { timeout: 15_000, polling: 100 }
);
```

**Phase 3 — Blocked (velocity vector assertion — CharacterMovement blocked walk → animState idle → broadcastVel zero):**
```ts
// When walk() is fully blocked (progress < minProgress), BotCharacterMovement
// returns animState: 'idle' and broadcastVel: {0,0,0}. This is what we assert:
await page.waitForFunction(
  ([b0, b1]) => {
    const state = window.__OFFICE_STORE__.getState();
    const p0 = state.players[b0];
    const p1 = state.players[b1];
    if (!p0 || !p1) return false;
    const blocked0 = Math.abs(p0.vel.x) < 0.05 && Math.abs(p0.vel.z) < 0.05;
    const blocked1 = Math.abs(p1.vel.x) < 0.05 && Math.abs(p1.vel.z) < 0.05;
    return blocked0 && blocked1;
  },
  [bot0Id, bot1Id],
  { timeout: 10_000, polling: 100 }
);
// Keyframe 2: both bots blocked, stable positions
await captureMotionKeyframe(page, 'scenario-collision/ideal/keyframe-02-blocked.png', { committed: true });
```

**Phase 4 — Position stability:**
```ts
const pos0Before = await getBotPos(page, bot0Id);
const pos1Before = await getBotPos(page, bot1Id);
await page.waitForTimeout(1_000);
const pos0After = await getBotPos(page, bot0Id);
const pos1After = await getBotPos(page, bot1Id);

const delta0 = Math.hypot(pos0After.x - pos0Before.x, pos0After.z - pos0Before.z);
const delta1 = Math.hypot(pos1After.x - pos1Before.x, pos1After.z - pos1Before.z);
expect(delta0, 'bot-0 should be stable (blocked)').toBeLessThan(0.05);
expect(delta1, 'bot-1 should be stable (blocked)').toBeLessThan(0.05);
```

**Phase 5 — Neither bot respawned:**
```ts
// Both bots still on platform (y still ≈ 2.5)
// If the dual-gate respawn fired incorrectly during collision (e.g., a
// false-positive hasFloorUnderneath=false from the floor probe while
// two bodies are in contact), this assertion would catch it.
const final0 = await getBotState(page, bot0Id);
const final1 = await getBotState(page, bot1Id);
expect(Math.abs(final0.pos.y - 2.5)).toBeLessThan(0.4);
expect(Math.abs(final1.pos.y - 2.5)).toBeLessThan(0.4);
```

## Existing Code References
- `tests/playwright/debug-character-grounded.spec.ts` — pattern for multi-bot state polling
- `tests/playwright/motion-helpers.ts` — `waitForBotCondition`, `captureMotionKeyframe` (task-09)
- `tests/playwright/motion-baselines/scenario-collision/manifest.json` — assertion thresholds (task-09)
- `packages/world/src/physics/character-movement.ts` — `CharacterMoveResult` shape (blocked walk → `animState: 'idle'`, `broadcastVel: {0,0,0}`, `moved: false`)
- `packages/world/src/bot/BotPhysicsWorld.ts` — `movementBlockThreshold` logic (the blocking mechanism that drives the `moved: false` in the result)

## Implementation Details

- `test.setTimeout(90_000)` — approach + contact detection may take up to 20 s.
- Two-bot setup: use `__OFFICE_BOTS__.setCount(2)`, then configure each bot. Check how `__OFFICE_BOTS__` maps bot index to player ID (likely `bot-001`, `bot-002`).
- For teleporting bots to specific positions: use `__OFFICE_BOTS__` respawn mechanism or direct store mutation for initial placement. The map's two spawn points are already at opposite Z ends.
- The blocking assertion is a **VECTOR assertion on `vel.z`** — not just position. This distinguishes "bots stopped because blocked by the shared CharacterMovement collision path" from "bots stopped because they randomly changed direction". With `linear-walk` mode, the intent is constant; the only reason `broadcastVel` drops to zero is that `BotCharacterMovement._step()` detected full blocking.
- Phase 5 is a deliberate regression check for the dual-gate respawn. A bug in the floor probe (`hasFloorUnderneath`) could cause a false-positive respawn during head-on collision (e.g., if two bots pressing against each other momentarily obscure the floor probe ray). This assertion guards against that.
- TDD does not apply to Playwright specs.

## Acceptance Criteria

- [ ] `tests/playwright/scenario-collision.spec.ts` exists
- [ ] Setup calls `setLinearWalkDir` for both bots — confirming the shared CharacterMovement walk() path is exercised
- [ ] Phase 1 (VECTOR): `vel.z > 0.1` for bot-0 and `vel.z < -0.1` for bot-1 during approach (walk() produces broadcastVel)
- [ ] Phase 3 (VECTOR): both bots' `vel.x` and `vel.z` within ±0.05 when blocked (blocked walk → idle → broadcastVel zero)
- [ ] Phase 4: position delta < 0.05 m over 1 s window after blocking
- [ ] Phase 5: neither bot has respawned (pos.y still near platform height) — dual-gate respawn has no false positives during collision
- [ ] 2 keyframe PNGs committed to `tests/playwright/motion-baselines/scenario-collision/ideal/`
- [ ] `pnpm exec playwright test tests/playwright/scenario-collision.spec.ts` passes
- [ ] `pnpm exec playwright test tests/playwright/mugshot-*` still passes
- [ ] `pnpm exec playwright test tests/playwright/character-on-surface.spec.ts` still passes

## Dependencies
- Depends on: task-01 (dual-gate rule), task-03 (CharacterMovement interface), task-04 (linear-walk mode), task-07 (collision platform map), task-09 (motion harness)
- Blocks: None
