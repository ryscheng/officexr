# Task 04: linear-walk Bot Mode

## Objective

Add a new `linear-walk` bot mode strategy that acts as a **pure intent source**: it computes a fixed XZ direction and calls `walk(dir)` on the shared `CharacterMovement` interface (via `BotDriver`). Plug it into `BOT_MODE_STRATEGIES` per OCP. Extend `ModeState` and `BotDriver` to accept a direction config. Expose direction seeding through `__OFFICE_BOTS__` so Playwright tests can control bot direction. Use TDD.

**This mode does NOT touch physics directly.** It returns a unit-vector direction to `BotDriver.tick()`, which then calls `this.movement.walk(dir, currentYaw)` on the `BotCharacterMovement` instance from task-03. The mode has no knowledge of speed, Rapier, gravity, or respawn — those all live in `CharacterMovement`.

## Context

**Quick Context:**
- `BotMode` union lives in `packages/world/src/bot/modes/types.ts`; add `'linear-walk'` there.
- `BOT_MODE_STRATEGIES` registry lives in `packages/world/src/bot/modes/index.ts`; add the new entry there (OCP — no changes to BotDriver's mode dispatch).
- `ModeState` (also in `types.ts`) is a shared scratch struct — add optional `linearWalkDir?: { x: number; z: number }` field.
- `BotPool.ts` exposes `__OFFICE_BOTS__` on `window`; check what's currently exposed and extend it.
- `BotDriver.tick()` now calls `this.movement.walk(intent, currentYaw)` (from task-03). The new linear-walk mode simply returns the configured direction as its intent — `BotDriver.tick()` maps it to `walk()` exactly as it does for all other modes.

## Requirements

### 1. Extend `BotMode` union in `types.ts`

```ts
export type BotMode =
  | 'idle'
  | 'walk-to-local'
  | 'walk-away'
  | 'wander'
  | 'patrol'
  | 'orbit'
  | 'linear-walk';  // new
```

### 2. Extend `ModeState` in `types.ts`

```ts
export interface ModeState {
  // ... existing fields ...
  /** Direction for linear-walk mode. Set by onEnter from config.
   * Defaults to {x:0, z:1} if not provided. */
  linearWalkDir: { x: number; z: number };
}
```

Initialize `linearWalkDir` to `{ x: 0, z: 1 }` in `BotDriver`'s initial `modeState` object.

### 3. New file: `packages/world/src/bot/modes/linearWalk.ts`

```ts
import type { BotModeStrategy, BotModeContext } from './types.ts';

/**
 * Pure intent source: returns a fixed unit XZ direction every tick.
 *
 * SRP: this strategy's sole job is to produce a direction vector.
 * It knows nothing about speed, Rapier, gravity, or respawn — those
 * all live in CharacterMovement (task-03). BotDriver.tick() maps
 * this direction to `this.movement.walk(dir, currentYaw)`.
 *
 * OCP: adding new configurable walk directions requires no changes
 * to this file or BotDriver — only the modeState.linearWalkDir
 * field is read, which is set externally via setModeWithConfig or
 * the __OFFICE_BOTS__ window hook.
 */
export const linearWalkStrategy: BotModeStrategy = {
  onEnter(ctx) {
    // linearWalkDir is set by BotDriver.setModeWithConfig before
    // onEnter fires. If not set, default to +Z.
    if (!ctx.modeState.linearWalkDir) {
      ctx.modeState.linearWalkDir = { x: 0, z: 1 };
    }
  },
  computeIntent(ctx): { x: number; z: number } {
    const dir = ctx.modeState.linearWalkDir ?? { x: 0, z: 1 };
    // Return unit-length XZ vector. Normalize defensively.
    const len = Math.hypot(dir.x, dir.z);
    if (len < 1e-6) return { x: 0, z: 1 };
    return { x: dir.x / len, z: dir.z / len };
  },
};
```

### 4. Register in `modes/index.ts`

```ts
import { linearWalkStrategy } from './linearWalk.ts';

export const BOT_MODE_STRATEGIES: Record<BotMode, BotModeStrategy> = {
  idle: idleStrategy,
  'walk-to-local': walkToLocalStrategy,
  'walk-away': walkAwayStrategy,
  wander: wanderStrategy,
  patrol: patrolStrategy,
  orbit: orbitStrategy,
  'linear-walk': linearWalkStrategy,  // new
};
```

### 5. Extend `BotDriver` with `setModeWithConfig`

```ts
/**
 * Switch to a mode and supply mode-specific config before the onEnter
 * hook fires. For linear-walk: `{ direction: { x, z } }`.
 */
setModeWithConfig(
  mode: BotMode,
  config?: { direction?: { x: number; z: number } },
): void {
  if (config?.direction) {
    this.modeState.linearWalkDir = config.direction;
  }
  this.setMode(mode); // existing method, calls onEnter
}
```

### 6. How `BotDriver.tick()` routes linear-walk intent

After task-03, `BotDriver.tick()` calls:

```ts
const intent = strategy.computeIntent(ctx); // {x,z} | null

const result = intent
  ? this.movement.walk(intent, currentYaw)   // walk() for all moving modes
  : this.movement.stop(currentYaw);
```

The linear-walk mode always returns a non-null `{x,z}` vector, so `BotDriver` always routes it through `walk()`. There is no special-casing for linear-walk in `BotDriver.tick()` — the mode is just another intent source.

If in the future a mode should use `run()` (e.g., a "sprint" mode), the routing decision belongs in `BotDriver.tick()` based on a mode property or context flag — not inside the individual strategy. For now, all moving modes map to `walk()`.

### 7. Expose via `__OFFICE_BOTS__` window hook

In `BotPool` (or wherever `__OFFICE_BOTS__` is constructed), add:

```ts
// On the window hook object:
setLinearWalkDir(botIndex: number, direction: { x: number; z: number }): void;
```

This calls `bot.setModeWithConfig('linear-walk', { direction })` on the bot at `botIndex`. Useful from Playwright tests to configure bot direction before a scenario starts.

Alternatively: if `__OFFICE_BOTS__` already exposes a per-bot `setMode` mechanism, extend it to accept `{ mode, config }` matching the `setModeWithConfig` signature. Check `BotPool.ts` for the current exposure shape and match the existing pattern.

### 8. Update `ALL_MODES` array in `types.ts`

```ts
export const ALL_MODES: readonly BotMode[] = [
  'idle', 'walk-to-local', 'walk-away', 'wander', 'patrol', 'orbit', 'linear-walk',
];
```

## Existing Code References
- `packages/world/src/bot/modes/types.ts` — extend `BotMode`, `ModeState`, `ALL_MODES`
- `packages/world/src/bot/modes/index.ts` — register new strategy
- `packages/world/src/bot/modes/wander.ts` — reference implementation for strategy shape
- `packages/world/src/bot/BotDriver.ts` — add `setModeWithConfig`; update `modeState` initializer; note that `tick()` now calls `this.movement.walk(intent, currentYaw)` (task-03)
- `packages/world/src/bot/BotPool.ts` — find where `__OFFICE_BOTS__` window hook object is built; extend it

## Implementation Details

- The new strategy is pure — no Rapier, no Three, no imports beyond `./types.ts`. It is testable in isolation.
- `setModeWithConfig` must set `modeState.linearWalkDir` BEFORE calling `setMode()` (which invokes `onEnter`) so `onEnter` sees the config.
- `computeIntent` returns a unit vector — `BotDriver.tick()` passes it directly to `this.movement.walk(dir, yaw)`, which normalizes defensively inside `BotCharacterMovement`.
- Direction normalization in the strategy: `Math.hypot` is available in all environments; no THREE.Vector3 needed.

## Acceptance Criteria

- [ ] `BotMode` union includes `'linear-walk'`
- [ ] `BOT_MODE_STRATEGIES['linear-walk']` is registered and not undefined
- [ ] `linearWalkStrategy.computeIntent` returns `{x:0, z:1}` when `modeState.linearWalkDir = {x:0, z:1}`
- [ ] `linearWalkStrategy.computeIntent` returns `{x:1, z:0}` (normalized) for `{x:2, z:0}`
- [ ] `BotDriver.setModeWithConfig('linear-walk', { direction: {x:0, z:1} })` works without error
- [ ] `__OFFICE_BOTS__` exposes a way to set linear-walk direction per bot from Playwright
- [ ] A bot in `linear-walk` mode with direction `{x:0,z:1}` calls `this.movement.walk({x:0,z:1}, currentYaw)` via `BotDriver.tick()` — verified by unit test on `BotDriver` or integration
- [ ] A bot in `linear-walk` mode physically moves in the configured direction (integration-level assertion in unit test with real Rapier world)
- [ ] Unit tests for `computeIntent` written FIRST (RED) then pass (GREEN)
- [ ] `ALL_MODES` includes `'linear-walk'`
- [ ] `BotDriver.test.ts` and `BotPool.respawn.test.ts` still pass
- [ ] `pnpm --filter @officexr/world test` passes

## Dependencies
- Depends on: task-03 (CharacterMovement interface — `BotDriver.tick()` calls `this.movement.walk(intent, yaw)`; the linear-walk mode is an intent source for that interface)
- Blocks: task-10, task-11, task-12 (all scenario specs depend on `linear-walk` being available)

## TDD Mode

This task uses Test-Driven Development. Write tests BEFORE implementation.

### Test Specifications
- **Test file**: `packages/world/src/bot/modes/linearWalk.test.ts` (new)
- **Test framework**: Vitest
- **Test command**: `pnpm --filter @officexr/world test`

### Tests to Write (pure strategy — no Rapier needed)

1. **direction {x:0, z:1}**: `computeIntent(ctx)` returns `{x:0, z:1}` exactly
2. **direction normalization**: `computeIntent` with `linearWalkDir = {x:2, z:0}` returns `{x:1, z:0}`
3. **zero vector fallback**: `computeIntent` with `linearWalkDir = {x:0, z:0}` returns `{x:0, z:1}` (default fallback)
4. **onEnter sets default**: calling `onEnter` with no `linearWalkDir` on `modeState` sets it to `{x:0, z:1}`
5. **intent is always unit length**: `Math.hypot(result.x, result.z)` is within 1e-6 of 1.0 for any valid direction input

### TDD Process
1. Write the tests above — they FAIL (RED) because `linearWalkStrategy` doesn't exist yet
2. Create `linearWalk.ts` and register it — tests pass (GREEN)
3. Run full suite: `pnpm --filter @officexr/world test`
4. Refactor if needed
