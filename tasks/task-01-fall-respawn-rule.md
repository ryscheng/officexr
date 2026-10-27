# Task 01: Dual-Gate Fall-Respawn Rule

## Objective
Add a dual-gate fall-respawn rule to `packages/world/src/physics/rules.ts` that fires when BOTH (a) no floor exists beneath the character within a probe range AND (b) downward velocity has reached a threshold. Wire it into `BotDriver.tick()` and expose a floor-probe method so `SceneFrame.tsx` can be wired in task-03. Use TDD.

## Context

**Quick Context:**
- The existing `respawnThreshold(worldObjects)` returns a Y-floor value (lowest cube bottom minus 10 m). It stays as a last-resort backstop — do not remove it.
- `BotDriver.tick()` currently calls `respawnThreshold` + a Y < threshold check on line ~323. This is the primary call site to update.
- `BotPhysicsWorld.step()` returns `{ corrected, progress, bumps }` — it does not yet expose grounded state or vertical velocity.

## Requirements

### 1. New constants in `rules.ts`
```ts
/** Downward speed (m/s, positive magnitude) at which a falling character
 * is eligible for respawn. Must hold simultaneously with no floor beneath. */
export const MAX_FALL_VELOCITY = 8;

/** Metres below character feet to probe for a floor surface.
 * If no floor is found within this range, condition (a) is met. */
export const FLOOR_PROBE_RANGE = 2.0;
```

### 2. New pure function in `rules.ts`
```ts
/**
 * Primary fall-respawn gate: returns true when BOTH conditions hold.
 *   (a) hasFloorUnderneath === false  (downward probe found no surface)
 *   (b) velY <= -MAX_FALL_VELOCITY    (falling fast enough)
 *
 * SRP: this function knows nothing about Rapier, React, or Three. It
 * receives pre-computed inputs from the caller (bot or player).
 *
 * Callers must ALSO check the Y-floor backstop (respawnThreshold) as a
 * last resort so a character that somehow bypasses this gate still
 * returns eventually.
 */
export function shouldRespawnFalling(
  velY: number,
  hasFloorUnderneath: boolean,
): boolean {
  return !hasFloorUnderneath && velY <= -MAX_FALL_VELOCITY;
}
```

### 3. `BotPhysicsWorld` — expose floor probe
Add a `probeFloor(fromPos: Vec3, range: number): boolean` method that performs a downward Rapier ray cast from `fromPos`, returning true if a surface is found within `range` metres. This is headless — Rapier only, no Three.

The method is called by `BotDriver.tick()` (after computing `newPos`) to feed `hasFloorUnderneath` into `shouldRespawnFalling`.

### 4. Wire into `BotDriver.tick()`
Replace the current primary respawn check:
```ts
// BEFORE (current)
const threshold = respawnThreshold(botState.worldObjects);
if (newPos.y < threshold) { ... }
```
With the new dual-gate:
```ts
// AFTER
const velY = stepResult.corrected.y / dtSec; // approximate vertical velocity
const hasFloor = this.physics.probeFloor(newPos, FLOOR_PROBE_RANGE);
const fallsBackstop = newPos.y < respawnThreshold(botState.worldObjects);
if (shouldRespawnFalling(velY, hasFloor) || fallsBackstop) { ... }
```
The backstop `respawnThreshold` check remains as the second condition (`||`), never the primary.

### 5. Export new symbols from `rules.ts`
`MAX_FALL_VELOCITY`, `FLOOR_PROBE_RANGE`, and `shouldRespawnFalling` must be named exports so task-03 can import them for the shared locomotion interface.

### 6. No changes to `SceneFrame.tsx` in this task
`SceneFrame.tsx` gets wired in task-03 (shared locomotion interface). This task only covers `BotDriver` + `BotPhysicsWorld` + `rules.ts`.

## Existing Code References
- `packages/world/src/physics/rules.ts` — add to this file; preserve all existing exports
- `packages/world/src/bot/BotDriver.ts` lines 322-330 — current respawn check to replace
- `packages/world/src/bot/BotPhysicsWorld.ts` — add `probeFloor` method; check existing Rapier world reference for ray-cast API
- `packages/world/src/bot/BotPool.respawn.test.ts` — existing test pattern for bot respawn

## Implementation Details
- `probeFloor`: cast a ray from `{x: fromPos.x, y: fromPos.y - charRadius, z: fromPos.z}` downward `{x:0, y:-1, z:0}` with max time-of-impact = `range`. Use Rapier's `world.castRay`. Return `toi !== null` (floor found).
- The vertical velocity approximation `stepResult.corrected.y / dtSec` is an estimate — the full `velY` tracking will be improved in task-03 when the locomotion interface tracks it explicitly. Document this inline:
  ```ts
  // ISP note: velY approximated here; task-03 (locomotion interface) will
  // surface the exact integrated velocity. For now this is sufficient for
  // the dual-gate rule.
  ```
- Follow the existing comment style in `rules.ts` (JSDoc blocks per export).
- No `import * as THREE` — Rapier ray-cast uses `{ x, y, z }` plain objects, not THREE.Vector3.

## Acceptance Criteria
- [ ] `shouldRespawnFalling(velY, hasFloor)` returns `true` only when `!hasFloor && velY <= -MAX_FALL_VELOCITY`
- [ ] `shouldRespawnFalling(-10, false)` === `true`; `shouldRespawnFalling(-10, true)` === `false`; `shouldRespawnFalling(-3, false)` === `false` (velocity not enough)
- [ ] Unit tests in `packages/world/src/physics/rules.test.ts` written FIRST (RED), then pass (GREEN)
- [ ] `BotPhysicsWorld.probeFloor(pos, range)` returns `true` when a surface exists within range, `false` otherwise
- [ ] A bot on a platform does NOT respawn (floor is probed, found)
- [ ] A bot in free-fall at >= MAX_FALL_VELOCITY with no floor beneath DOES trigger respawn
- [ ] Y-floor backstop (`respawnThreshold`) still fires if the dual-gate somehow doesn't (e.g., floor probe misses)
- [ ] No `import * as THREE` in `rules.ts` or `BotPhysicsWorld.ts` additions
- [ ] DIP greps return zero matches: `grep -rn "from 'three'" packages/sdk packages/core-refactor`
- [ ] `pnpm --filter @officexr/world test` passes (all unit tests green, including pre-existing ones)

## Dependencies
- Depends on: None
- Blocks: task-03 (shared locomotion interface uses `shouldRespawnFalling` and `FLOOR_PROBE_RANGE`)

## TDD Mode

This task uses Test-Driven Development. Write tests BEFORE implementation.

### Test Specifications
- **Test file**: `packages/world/src/physics/rules.test.ts` (new file, or extend if it exists)
- **Test framework**: Vitest
- **Test command**: `pnpm --filter @officexr/world test`

### Tests to Write
1. **`shouldRespawnFalling` — both gates open**: `shouldRespawnFalling(-MAX_FALL_VELOCITY, false)` should be `true`
2. **`shouldRespawnFalling` — floor present**: `shouldRespawnFalling(-MAX_FALL_VELOCITY, true)` should be `false`
3. **`shouldRespawnFalling` — velocity below threshold**: `shouldRespawnFalling(-3, false)` should be `false`
4. **`shouldRespawnFalling` — ascending velocity**: `shouldRespawnFalling(2, false)` should be `false`
5. **`shouldRespawnFalling` — exactly at threshold**: `shouldRespawnFalling(-MAX_FALL_VELOCITY, false)` should be `true` (boundary inclusive)
6. **`shouldRespawnFalling` — just below threshold**: `shouldRespawnFalling(-(MAX_FALL_VELOCITY - 0.01), false)` should be `false`

### TDD Process
1. Write the tests above — they should FAIL (RED) because `shouldRespawnFalling` does not exist yet
2. Implement `shouldRespawnFalling` and the constants — tests should pass (GREEN)
3. Run the full unit test suite to check for regressions: `pnpm --filter @officexr/world test`
4. Refactor if needed while keeping tests green
