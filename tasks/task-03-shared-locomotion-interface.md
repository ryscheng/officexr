# Task 03: CharacterMovement Intent-Command Interface

## Objective

Define and implement the **CharacterMovement** intent-command interface — the single, shared code path through which every character (human player and bot) moves each tick. Adapt `BotDriver` to issue intents through it; adapt `SceneFrame.tsx` to do the same. Wire the dual-gate fall-respawn rule from task-01 into this one path. Use TDD.

## Context

**Quick Context:**
- `BotPhysicsWorld.step()` today takes `{x, z, dtSec}` as raw delta amounts (pre-multiplied by speed) and returns `StepResult { corrected, progress, bumps, grounded }`. It already tracks `private verticalVel` internally. Task-03 surfaces `velY` and `hasFloorUnderneath` from this same class.
- `SceneFrame.tsx` has a completely separate per-frame loop: its own `verticalVelRef`, its own Rapier controller (obtained via `useRapier()`), and a Y-floor-only respawn check. The goal of this task is to unify this with the bot path — same verbs, same respawn gate, same animation-state derivation.
- `shouldRespawnFalling`, `MAX_FALL_VELOCITY`, `FLOOR_PROBE_RANGE` are added by task-01 and must be imported here.
- The interface must stay in `packages/world/src/physics/` — headless, no Three, no React. DIP greps must stay clean.
- The migration is incremental. At every commit the full unit test suite passes.

## Requirements

### 1. New file: `packages/world/src/physics/character-movement.ts`

Define the intent-command interface and result type. This file contains only TypeScript interfaces and types — zero runtime logic, no Rapier import. It is the contract that both `BotCharacterMovement` and the `SceneFrame`-side adapter satisfy.

```ts
/**
 * CharacterMovement — the intent-command API for character locomotion.
 *
 * Every character in the world (human player, bot) moves through this
 * interface each tick. The caller is an INTENT SOURCE (keyboard input,
 * a bot mode strategy). The implementer owns: physics step, gravity
 * integration, collision resolution, snap-to-ground, floor probe, and
 * dual-gate fall-respawn gating.
 *
 * DIP: this file lives in the headless physics layer. It has no Three,
 * no React, no r3f imports. SceneFrame (React) and BotDriver (Rapier)
 * depend on this interface — not the reverse.
 *
 * SRP: the interface owns only "intent verb → corrected move + state".
 * Broadcasting, store updates, and bus events are the caller's concern.
 *
 * OCP: new verbs (crouch, dash) are additive — add a method and a new
 * 'animState' literal; existing consumers need not change.
 */

import type { Vec3 } from '@officexr/sdk';

/**
 * The result every verb method returns. Callers use this to:
 *   - apply the new position to the physics body / store
 *   - derive broadcast vel and yaw for peers
 *   - check whether a respawn should fire
 *   - select the animation state for the character avatar
 */
export interface CharacterMoveResult {
  /** Physics-corrected new world-space position. */
  newPos: Vec3;
  /** Velocity to broadcast to peers (for extrapolation + animation). */
  broadcastVel: Vec3;
  /** Yaw (facing direction) to broadcast. Unchanged for stop(). */
  broadcastYaw: number;
  /** True if the character actually moved this tick (not fully blocked). */
  moved: boolean;
  /** Animation state derived from the verb and whether the move succeeded. */
  animState: 'idle' | 'walk' | 'run';
  /** Current integrated vertical velocity (m/s, negative = falling). */
  velY: number;
  /** True if the downward floor probe finds a surface within FLOOR_PROBE_RANGE. */
  hasFloorUnderneath: boolean;
  /** True if the Rapier controller reports the character is on solid ground. */
  isGrounded: boolean;
  /** Bump events from this step (edge-triggered, for bus emission). */
  bumps: Array<{ otherId: string; normal: { x: number; z: number } }>;
}

/**
 * Intent-command interface. One implementation per physics context
 * (BotCharacterMovement for headless Rapier; SceneFrameCharacterMovement
 * for the r3f-hosted Rapier world inside the Canvas).
 */
export interface CharacterMovement {
  /**
   * Walk in the given unit XZ direction at walk speed.
   * @param dir - Unit XZ direction vector. Normalized defensively inside.
   * @param currentYaw - Current facing yaw (used as fallback if blocked).
   */
  walk(dir: { x: number; z: number }, currentYaw: number): CharacterMoveResult;

  /**
   * Run in the given unit XZ direction at run speed.
   * @param dir - Unit XZ direction vector. Normalized defensively inside.
   * @param currentYaw - Current facing yaw.
   */
  run(dir: { x: number; z: number }, currentYaw: number): CharacterMoveResult;

  /**
   * No horizontal intent this tick. Gravity and floor probe still apply.
   * @param currentYaw - Current facing yaw (preserved in result).
   */
  stop(currentYaw: number): CharacterMoveResult;

  /** Force the character to a new world position; zero vertical velocity. */
  teleport(pos: Vec3): void;

  /** Current world-space position. */
  getPosition(): Vec3;
}
```

### 2. New class: `BotCharacterMovement` in `packages/world/src/physics/bot-character-movement.ts`

A concrete implementation of `CharacterMovement` backed by `BotPhysicsWorld`. This is where the physics logic lives for bots — it wraps the existing `BotPhysicsWorld` step and adds:
- `velY` exposure (the existing `private verticalVel` field, now readable from step results)
- `hasFloorUnderneath` via a downward ray cast after each step
- `animState` derivation from verb + `moved`
- `broadcastVel` and `broadcastYaw` derivation

**Key implementation notes:**
- `BotPhysicsWorld.step()` signature does NOT change (it takes `{x, z, dtSec}`). `BotCharacterMovement` wraps it and pre-multiplies direction by speed (from `tunables`) before calling `step()`. This keeps `BotPhysicsWorld` stable.
- The `velY` value is needed in the result. `BotPhysicsWorld` already tracks `private verticalVel`. Expose it by adding a `getVerticalVel(): number` getter to `BotPhysicsWorld` (a one-line accessor — no logic change).
- `hasFloorUnderneath`: implement a downward ray cast from the character's feet position, depth `FLOOR_PROBE_RANGE`, using `this.physicsWorld.world.castRay(...)`. The `BotPhysicsWorld` will expose a `probeFloor(fromPos: Vec3, range: number): boolean` method that encapsulates this.
- Speed values come from `resolveCharacterTunables` output passed into the constructor. `BotCharacterMovement` holds a reference to the latest tunables; `BotDriver.tick()` updates them before each call.

```ts
// packages/world/src/physics/bot-character-movement.ts
import type { Vec3 } from '@officexr/sdk';
import { shouldRespawnFalling, FLOOR_PROBE_RANGE } from './rules.ts';
import type { CharacterMovement, CharacterMoveResult } from './character-movement.ts';
import type { BotPhysicsWorld } from '../bot/BotPhysicsWorld.ts';

export interface BotMovementTunables {
  walkSpeed: number;
  runSpeed: number;
  movementBlockThreshold: number;
}

export class BotCharacterMovement implements CharacterMovement {
  constructor(
    private readonly physics: BotPhysicsWorld,
    private tunables: BotMovementTunables,
  ) {}

  /** Called by BotDriver.tick() before each step to use the frame's tunables. */
  updateTunables(t: BotMovementTunables): void {
    this.tunables = t;
  }

  walk(dir: { x: number; z: number }, currentYaw: number): CharacterMoveResult {
    return this._step(dir, this.tunables.walkSpeed, 'walk', currentYaw);
  }

  run(dir: { x: number; z: number }, currentYaw: number): CharacterMoveResult {
    return this._step(dir, this.tunables.runSpeed, 'run', currentYaw);
  }

  stop(currentYaw: number): CharacterMoveResult {
    return this._step(null, 0, 'idle', currentYaw);
  }

  teleport(pos: Vec3): void {
    this.physics.teleport(pos);
  }

  getPosition(): Vec3 {
    return this.physics.translation();
  }

  private _step(
    dir: { x: number; z: number } | null,
    speed: number,
    verb: 'walk' | 'run' | 'idle',
    currentYaw: number,
    dtSec: number,
  ): CharacterMoveResult {
    // ... full implementation in the actual file
  }
}
```

> **Note to implementer:** The `dtSec` parameter is threaded through from `BotDriver.tick()`. The full private `_step` implementation:
> 1. Normalizes `dir` defensively.
> 2. Computes `moveDX = dir.x * speed * dtSec`, `moveDZ = dir.z * speed * dtSec` (or zero for `stop`).
> 3. Calls `this.physics.step({ x: moveDX, z: moveDZ, dtSec })`.
> 4. Reads `velY = this.physics.getVerticalVel()`.
> 5. Reads `hasFloorUnderneath = this.physics.probeFloor(this.physics.translation(), FLOOR_PROBE_RANGE)`.
> 6. Determines `moved` from `stepResult.progress >= minProgress && dir !== null`.
> 7. Derives `animState`: `moved ? verb : 'idle'` (where `verb` is the passed-in verb, or `'idle'` for `stop`).
> 8. Derives `broadcastVel` and `broadcastYaw` from `animState` and `dir`.
> 9. Computes `newPos` from `this.physics.translation() + stepResult.corrected` (following existing `BotDriver.tick()` logic).
> 10. Calls `this.physics.applyTranslation(newPos)`.
> 11. Returns `CharacterMoveResult`.

### 3. Add accessors to `BotPhysicsWorld`

Two small additions — no logic changes:

```ts
// In BotPhysicsWorld:

/** Current integrated fall speed (m/s, negative = falling). */
getVerticalVel(): number {
  return this.verticalVel;
}

/**
 * Downward floor probe: casts a ray from `fromPos` downward by `range` m.
 * Returns true if a surface is found within that range.
 * Used by BotCharacterMovement to populate CharacterMoveResult.hasFloorUnderneath.
 */
probeFloor(fromPos: Vec3, range: number): boolean {
  const ray = new RAPIER.Ray(
    { x: fromPos.x, y: fromPos.y, z: fromPos.z },
    { x: 0, y: -1, z: 0 },
  );
  const hit = this.world.castRay(ray, range, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
  return hit !== null;
}
```

### 4. Adapt `BotDriver.tick()` to use `BotCharacterMovement`

Replace the current manual physics orchestration in `BotDriver.tick()` with calls to the CharacterMovement interface:

```ts
// Before (current code in BotDriver.tick()):
const moveDX = intent ? intent.x * speed * dtSec : 0;
const moveDZ = intent ? intent.z * speed * dtSec : 0;
const stepResult = this.physics.step({ x: moveDX, z: moveDZ, dtSec });
// ... manual newPos / vel / yaw / moved derivation ...
// ... Y-floor-only respawn check ...

// After (task-03):
this.movement.updateTunables({
  walkSpeed: tunables.playerSpeed,
  runSpeed: tunables.playerSpeed * tunables.runSpeedMultiplier,
  movementBlockThreshold: botState.worldSettings.movementBlockThreshold,
});
const currentYaw = botState.players[this.botId]?.yaw ?? 0;
const result = intent
  ? this.movement.walk(intent, currentYaw)   // linear-walk always uses walk
  : this.movement.stop(currentYaw);

this.emitControllerBumps(result.bumps);

// Wander early-pivot on block (mode-specific, not part of CharacterMovement):
if (intent && this.mode === 'wander' && !result.moved) {
  strategy.onEnter?.(ctx);
}

// Dual-gate respawn (from CharacterMoveResult — one call site for all characters):
const backstopY = respawnThreshold(botState.worldObjects);
if (
  shouldRespawnFalling(result.velY, result.hasFloorUnderneath) ||
  result.newPos.y < backstopY
) {
  const respawnPos = pickRespawnPosition(this.spawnList);
  if (respawnPos) {
    this.movement.teleport(respawnPos);
    // Override result fields for broadcast:
    result.newPos = respawnPos;
    result.broadcastVel = { x: 0, y: 0, z: 0 };
    result.broadcastYaw = currentYaw;
    result.moved = false;
  }
}

this.botActions.setSelfPosition(result.newPos, result.broadcastVel, result.broadcastYaw, false);
this.physics.stepWorld();
this.flushEvents();
this.botSync.flushPosition();
this.botHandshake.tickTimers();
this.wasMoving = result.moved;
```

`BotDriver` holds `private movement: BotCharacterMovement` initialized in `start()` after `BotPhysicsWorld` is created:
```ts
this.movement = new BotCharacterMovement(this.physics, {
  walkSpeed: tunables.playerSpeed,
  runSpeed: tunables.playerSpeed * tunables.runSpeedMultiplier,
  movementBlockThreshold: state.worldSettings.movementBlockThreshold,
});
```

**Behavior-preserving:** `BotDriver.test.ts` and `BotPool.respawn.test.ts` must still pass after this change. The observable behavior (position updates, velocity broadcasts, respawn behavior) must not change — only the internal code path changes.

### 5. Adapt `SceneFrame.tsx` to use the same intent verbs and the dual-gate respawn

`SceneFrame.tsx` does NOT need to switch to `BotCharacterMovement` — it has a different physics context (the r3f-hosted Rapier world, obtained via `useRapier()`). The goal is to unify the BEHAVIOR, not necessarily the class:

**Required changes to `SceneFrame.tsx`:**

a) **Replace the Y-floor-only respawn check** with the dual-gate rule from task-01. The existing `verticalVelRef` already tracks `velY`. Add a downward floor probe analogous to `BotPhysicsWorld.probeFloor()`:

```ts
// After computeColliderMovement, before respawn check:
const floorRay = new RAPIER.Ray(
  { x: newPos.x, y: newPos.y, z: newPos.z },
  { x: 0, y: -1, z: 0 }
);
const floorHit = world.castRay(floorRay, FLOOR_PROBE_RANGE, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
const hasFloorUnderneath = floorHit !== null;

// Replace the old threshold check:
// OLD: if (newPos.y < threshold) { ... }
// NEW:
if (
  shouldRespawnFalling(verticalVelRef.current, hasFloorUnderneath) ||
  newPos.y < backstopThreshold
) {
  // same respawn logic as today
}
```

b) **Annotate the intent-verb pattern explicitly** in a comment so it's clear this mirrors the CharacterMovement interface:

```ts
// Intent verb (mirrors CharacterMovement interface):
// isRunning + (fwd || strafe) → 'run' verb
// !isRunning + (fwd || strafe) → 'walk' verb
// neither → 'stop' verb
```

c) **SRP violation note** (pre-existing, document it):

```ts
// SRP violation: SceneFrame owns WASD input, physics step, gravity,
// respawn, broadcast, and bot/world ticks. This is a pre-existing bend
// forced by React/r3f: `useRapier()` must be called inside the Canvas
// component tree, and `useFrame` must be called from a mounted component,
// so the per-frame physics step cannot be split into a separate module
// without a significant r3f refactor. The dual-gate respawn rule and
// intent-verb pattern are adopted here to ensure behavioral parity with
// BotCharacterMovement without restructuring the component model.
// What would remove this: extract SceneFrame's physics step into a
// headless class that accepts `world` + `controller` as constructor args,
// wrapping it in a thin r3f component that calls useRapier/useFrame.
```

### 6. TDD for the interface and `BotCharacterMovement`

Write unit tests BEFORE implementing `BotCharacterMovement`. Tests require Rapier setup via `packages/world/src/__tests__/setup-rapier.ts`.

## Existing Code References
- `packages/world/src/physics/rules.ts` — import `shouldRespawnFalling`, `MAX_FALL_VELOCITY`, `FLOOR_PROBE_RANGE` (added by task-01); `GRAVITY`, `CHARACTER_CONTROLLER_SKIN`, `respawnThreshold`, `pickRespawnPosition`
- `packages/world/src/bot/BotPhysicsWorld.ts` — extend with `getVerticalVel()` and `probeFloor()`; `step()` signature stays unchanged
- `packages/world/src/bot/BotDriver.ts` — lines 222–339 (full `tick()` method), lines 117–132 (modeState init, speed defaults); adapt tick to use `BotCharacterMovement`
- `packages/world/src/renderer/SceneFrame.tsx` — lines 246–645 (`useFrame` callback); add floor probe + dual-gate respawn, annotate intent-verb pattern
- `packages/world/src/characters/resolve.ts` — `resolveCharacterTunables` signature (for `BotMovementTunables` source)

## Implementation Details

- New files: `packages/world/src/physics/character-movement.ts` (interface only, zero runtime) and `packages/world/src/physics/bot-character-movement.ts` (implementation).
- `character-movement.ts` imports only from `@officexr/sdk` (for `Vec3`). Zero Rapier, zero Three, zero React.
- `bot-character-movement.ts` imports Rapier (for the `Ray` type inside `BotPhysicsWorld.probeFloor`). It also imports `shouldRespawnFalling` and `FLOOR_PROBE_RANGE` from `./rules.ts`.
- `BotPhysicsWorld.probeFloor()` uses `this.world.castRay()`. The `RAPIER` import is already present in that file.
- `BotDriver.movement` is initialized in `start()` after `this.physics` is set. `BotDriver.stop()` sets `this.movement = null` (or `undefined`) so callers know the driver is torn down.
- Incremental commit sequence: (1) `character-movement.ts` interfaces; (2) `BotPhysicsWorld` accessors; (3) `BotCharacterMovement` class + unit tests GREEN; (4) `BotDriver.tick()` adaptation; (5) `SceneFrame.tsx` dual-gate respawn + annotation. Keep `pnpm --filter @officexr/world test` green after each step.

## Acceptance Criteria

- [ ] `packages/world/src/physics/character-movement.ts` exists, exports `CharacterMovement` and `CharacterMoveResult` with all specified fields
- [ ] `packages/world/src/physics/bot-character-movement.ts` exports `BotCharacterMovement` implementing `CharacterMovement`
- [ ] `BotPhysicsWorld` exposes `getVerticalVel(): number` and `probeFloor(fromPos, range): boolean`
- [ ] `BotCharacterMovement.walk(dir, yaw)` returns a result with `animState: 'walk'` and non-zero `broadcastVel` when movement is not blocked
- [ ] `BotCharacterMovement.stop(yaw)` returns a result with `animState: 'idle'` and zero `broadcastVel`
- [ ] `BotCharacterMovement.walk(dir, yaw)` returns `animState: 'idle'` when movement is fully blocked (blocked by a wall)
- [ ] `CharacterMoveResult.velY` is negative and growing in magnitude after N ticks with no ground contact
- [ ] `CharacterMoveResult.velY` resets to ~0 when the character lands on ground
- [ ] `CharacterMoveResult.hasFloorUnderneath` is `true` when character is above a cube within `FLOOR_PROBE_RANGE`
- [ ] `CharacterMoveResult.hasFloorUnderneath` is `false` when character is above empty space beyond `FLOOR_PROBE_RANGE`
- [ ] `BotDriver.tick()` uses `result.velY` and `result.hasFloorUnderneath` to gate `shouldRespawnFalling` (dual-gate, not Y-floor-only)
- [ ] `BotDriver.tick()` retains Y-floor backstop (`respawnThreshold`) as a secondary safety net
- [ ] `SceneFrame.tsx` uses `shouldRespawnFalling(verticalVelRef.current, hasFloorUnderneath)` for the primary respawn trigger
- [ ] `SceneFrame.tsx` retains the Y-floor backstop as secondary
- [ ] `SceneFrame.tsx` has the SRP violation note as specified
- [ ] `SceneFrame.tsx` has the intent-verb pattern comment as specified
- [ ] Unit tests written FIRST (RED) then pass (GREEN)
- [ ] `BotDriver.test.ts` and `BotPool.respawn.test.ts` still pass
- [ ] No `three` or `react` imports in `character-movement.ts` or `bot-character-movement.ts`
- [ ] DIP greps return zero matches: `grep -rn "from 'three'" packages/sdk packages/core-refactor`
- [ ] `pnpm --filter @officexr/world test` passes (full unit suite)
- [ ] `pnpm exec playwright test tests/playwright/mugshot-*` passes (renderer unaffected)
- [ ] `pnpm exec playwright test tests/playwright/character-on-surface.spec.ts` passes

## Dependencies
- Depends on: task-01 (fall-respawn rule — `shouldRespawnFalling`, `FLOOR_PROBE_RANGE` must exist)
- Blocks: task-04 (linear-walk mode issues `walk()` intents through this interface)

## TDD Mode

This task uses Test-Driven Development. Write tests BEFORE implementation.

### Test Specifications
- **Test file**: `packages/world/src/physics/bot-character-movement.test.ts` (new)
- **Test framework**: Vitest (with Rapier setup via `packages/world/src/__tests__/setup-rapier.ts`)
- **Test command**: `pnpm --filter @officexr/world test`

### Tests to Write

1. **`walk()` moves character**: place character above a flat platform; call `walk({x:0,z:1}, 0)` for N ticks; assert `result.newPos.z > startZ` and `result.animState === 'walk'`

2. **`stop()` keeps animState idle**: call `stop(0)` while character is grounded; assert `result.animState === 'idle'` and `result.broadcastVel` is `{x:0,y:0,z:0}`

3. **blocked walk → animState idle**: place character against a wall; call `walk({x:0,z:1}, 0)`; assert `result.animState === 'idle'` (blocked → treated as stopped)

4. **velY accumulates gravity**: call `stop(0)` N times with no ground contact; assert `result.velY` is negative and `|result.velY|` increases each tick

5. **velY resets on landing**: let character fall to a platform; once `result.isGrounded === true`, assert `result.velY` is near zero (≤ 0.01)

6. **hasFloorUnderneath true above platform**: character placed 1 m above a cube; assert `result.hasFloorUnderneath === true`

7. **hasFloorUnderneath false in open air**: character placed above empty space with no cube within `FLOOR_PROBE_RANGE`; assert `result.hasFloorUnderneath === false`

8. **CharacterMoveResult shape**: call any verb; assert result has all required fields (`newPos`, `broadcastVel`, `broadcastYaw`, `moved`, `animState`, `velY`, `hasFloorUnderneath`, `isGrounded`, `bumps`)

9. **`run()` uses run speed**: call `run({x:0,z:1}, 0)` for one tick with known tunables; assert `|broadcastVel.z|` equals `runSpeed` (within floating-point tolerance)

10. **`walk()` uses walk speed**: same as above but `walk()` and `walkSpeed`

### TDD Process
1. Write the tests above — they should FAIL (RED)
2. Add `BotPhysicsWorld` accessors, implement `BotCharacterMovement` — tests pass (GREEN)
3. Adapt `BotDriver.tick()` — run full suite for regressions
4. Adapt `SceneFrame.tsx` — run full suite + e2e regression check
5. Refactor if needed while keeping all tests green
