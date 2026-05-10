# Task 07: Implement BotDriver — fully simulated second client

## Objective
Implement `BotDriver`, a headless class that runs a second fully simulated client (own Store + SyncEngine + InMemoryChannel) on the same hub as the local player, with controllable movement modes.

## Context
- Read `tasks/shared-context.md` before starting.
- Study `packages/sdk/src/test-harness/two-client.ts` (`createMultiClientHarness`) — `BotDriver.start()` performs exactly the same bootstrap sequence for the bot client as `harness.add(id)` does.
- The bot's position broadcast goes through `botChannel → hub → localChannel → SyncEngine → actions.applyRemotePosition` on the local client — the same code path as real network messages. This ensures the proximity rule sees the bot naturally in the local client's store.
- `FakeClock` is used in tests; in the browser, the real `performance.now()` clock is passed.
- `BOT_ID = 'bot-001'` is the bot's player id.

**Quick Context:**
- `BotDriver` lives at `packages/debug-app/src/bot/BotDriver.ts`.
- Bot `tick(dt)` is called from the RAF loop in Task 06; in tests, it is called manually.
- `localPlayerPosGetter: () => Vec3` is injected so the bot can compute direction without holding a reference to the local client's store.

## Files to Create
- `packages/debug-app/src/bot/BotDriver.ts`
- `packages/debug-app/src/bot/BotDriver.test.ts` — TDD tests

## Requirements

### Constructor options
```ts
export interface BotDriverOptions {
  hub: ReturnType<typeof createInMemoryChannelHub>;
  localPlayerPosGetter: () => Vec3;
  botId?: string;          // default 'bot-001'
  speed?: number;          // m/s, default 1.5
  startPos?: Vec3;         // default { x: 10, y: 0, z: 0 }
  /** Injected clock for tests. Default: { now: () => performance.now() } */
  clock?: Clock;
}
```

### Public API
```ts
class BotDriver {
  async start(): Promise<void>   // bootstrap bot client, subscribe, start sync
  stop(): void                   // stop sync, close channel
  tick(dt: number): void         // advance bot position + flush sync
  setMode(mode: 'idle' | 'walk-to-local' | 'walk-away'): void
  getBotPos(): Vec3              // current bot position (from bot's own store)
  readonly botId: string
}
```

### `start()` bootstrap sequence
Mirrors `createMultiClientHarness`'s `add()` function:
```
1. Create bot's Store: createStore({ selfId: botId, officeId: 'debug-office' })
2. Create bot's Bus: createBus()
3. Create bot's Actions: createActions(botStore, botBus)
4. Seed bot player: botActions.upsertPlayer({ id: botId, name: 'Bot', pos: startPos, vel:{x:0,y:0,z:0}, yaw:0 })
5. Create bot's Channel: new InMemoryChannel(hub, botId)
6. Create bot's SyncEngine: new SyncEngine({ store: botStore, actions: botActions, bus: botBus, channel: botChannel, clock })
7. await botChannel.subscribe()
8. botChannel.trackPresence({})
9. botSync.start()
```
Note: bot does NOT need SnapshotHandshake (it starts with a known empty state; the local client requests a snapshot via handshake, and the bot responds correctly because it has SyncEngine started).

Actually, to respond correctly to snapshot requests, the bot SHOULD also start a `SnapshotHandshake`. Include it following the same pattern as the harness.

### `tick(dt: number)` logic
```
if mode === 'idle': no movement
if mode === 'walk-to-local':
  dir = normalize(localPos - botPos) on XZ plane
  newPos = botPos + dir * speed * (dt / 1000)
  botActions.setSelfPosition(newPos, vel, 0)
  botSync.flushPosition()
  botHandshake.tickTimers()
if mode === 'walk-away':
  dir = normalize(botPos - localPos) on XZ plane (opposite)
  newPos = botPos + dir * speed * (dt / 1000)
  clamp to maxDistance (default 20 m from origin) to avoid infinite drift
  botActions.setSelfPosition(newPos, vel, 0)
  botSync.flushPosition()
  botHandshake.tickTimers()
```

### `stop()`
- `botSync.stop()`
- `botHandshake.stop()`
- `botChannel.close()`

## Acceptance Criteria
- [ ] After `await botDriver.start()`, the bot's channel is subscribed and the bot is present on the hub.
- [ ] `botDriver.getBotPos()` returns `startPos` before any ticks.
- [ ] After `setMode('walk-to-local')` and 10 `tick(100)` calls, `getBotPos()` is closer to `localPlayerPosGetter()` than the initial position.
- [ ] When the bot is within `BUBBLE_RADIUS` of the local player's position, and the local client's store has been updated (via the in-memory channel), `store.getState().proximity[SELF_ID]` contains `BOT_ID`.
- [ ] `botDriver.stop()` does not throw and subsequent `tick()` calls are safe no-ops.
- [ ] `pnpm --filter @officexr/debug-app test` passes.

## Dependencies
- Depends on: Task 05 (package scaffold)
- Blocks: Task 06, Task 08, Task 10

## TDD Mode

This task uses Test-Driven Development. Write tests BEFORE implementation.

### Test Specifications
- **Test file**: `packages/debug-app/src/bot/BotDriver.test.ts`
- **Test framework**: Vitest
- **Test command**: `pnpm --filter @officexr/debug-app test`

### Tests to Write
1. **initial position**: after `start()`, `getBotPos()` equals `startPos`. Expected: pass.
2. **idle mode does not move**: `setMode('idle')`, call `tick(100)` 5 times, assert `getBotPos()` unchanged. Expected: pass.
3. **walk-to-local moves bot closer**: `setMode('walk-to-local')`, tick 10 times at 100 ms each, assert distance to local player decreased. Expected: pass.
4. **walk-away moves bot farther**: place local player at origin, bot at `{x:2, y:0, z:0}`, `setMode('walk-away')`, tick 5 times, assert `getBotPos().x > 2`. Expected: pass.
5. **stop is safe**: `start()` then `stop()` then `tick(100)` — no throw. Expected: pass.
6. **bot broadcasts position to hub**: after `start()`, create a second `InMemoryChannel` on the same hub manually; after `tick(100)` in `walk-to-local` mode, verify a `presence:position` or `player:move` NetEvent was received. (Use a spy on the second channel's `on` handler.) Expected: at least one event received.

### TDD Process
1. Write the tests above — they should FAIL (RED)
2. Implement `BotDriver` (GREEN)
3. Run `pnpm --filter @officexr/debug-app test`
4. Refactor while keeping tests green
