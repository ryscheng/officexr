# Task 10: Write integration test for local debug stack (TDD)

## Objective
Write a headless Vitest integration test that spins up the full local stack (no DOM, no canvas, no audio), drives the bot to proximity, and asserts that voice-room routing fires correctly.

## Context
- Read `tasks/shared-context.md` before starting.
- This test is the "TDD proof" for the integration wiring in Task 06. Write and run it before Task 06's integration is complete to confirm it fails; then confirm it passes after Task 06 is complete.
- The test uses `FakeClock` from `@officexr/sdk/test-harness` so time is deterministic. Pass the same `FakeClock` instance to both the local client's `SyncEngine` and the `BotDriver`.
- The test must run in `environment: 'node'` (no `window`, no `document`). `LocalVoiceAdapter` uses `setTimeout` — use `vi.useFakeTimers()` to control it, or pass `participantJoinDelay: 0` to make events synchronous.
- No Three.js, no React, no audio in this test.

**Quick Context:**
- Test file: `packages/debug-app/src/__tests__/local-stack-integration.test.ts`
- Proximity rule is `BUBBLE_RADIUS = 3` (XZ plane).
- The test bootstraps the local client manually (same pattern as `createMultiClientHarness` but without using the harness's `add()` helper — construct it inline so the test is self-documenting).

## Files to Create
- `packages/debug-app/src/__tests__/local-stack-integration.test.ts`

## Requirements

### Test file structure
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createStore, createActions, createBus, createRuleRegistry,
  attachProximityReducer, proximityRule, BUBBLE_RADIUS,
  serializeOfficeState, SyncEngine, SnapshotHandshake,
  createInMemoryChannelHub, InMemoryChannel, FakeClock,
} from '@officexr/sdk';
import { Communication, createStack } from '@officexr/core-refactor';
import { BotDriver } from '../bot/BotDriver.ts';
import { LocalVoiceAdapter } from '@officexr/core-refactor'; // or from adapters sub-path
```

### Test: "bot walks to local player → Communication joins a room"
```
Given:
  - hub = createInMemoryChannelHub()
  - clock = new FakeClock(0)
  - Local client bootstrapped with SELF_ID = 'local-player' at pos {x:0,y:0,z:0}
  - Local Communication using LocalVoiceAdapter (participantJoinDelay: 0)
  - BotDriver with same hub, localPlayerPosGetter reading local store, starting at {x:10,y:0,z:0}
  - All SyncEngines use the same FakeClock

When:
  - botDriver.setMode('walk-to-local')
  - Repeat until bot is within BUBBLE_RADIUS:
      clock.advance(100)
      sync.flushPosition(); handshake.tickTimers()
      botDriver.tick(100)
      botSync.flushPosition(); botHandshake.tickTimers()
      // apply proximity rule on local client
      rules.tick(store.getState(), prevState, bus)
      prevState = store.getState()

Then:
  - communication.getCurrentRoom() is not null
  - localVoiceAdapter.getCurrentRoom() is not null
  - store.getState().proximity['local-player'] contains 'bot-001' (or whatever BOT_ID is)
```

### Additional test: "bot leaves → Communication leaves room"
```
Given: same setup, bot has already entered proximity
When:
  - botDriver.setMode('walk-away')
  - Step time until bot exits BUBBLE_RADIUS (run up to 30 steps)
Then:
  - communication.getCurrentRoom() is null
  - localVoiceAdapter.getCurrentRoom() is null
```

### Max iteration guard
Each loop should have a maximum iteration count (e.g. 100 steps) to prevent infinite loops if wiring breaks. If the condition is not met, `expect.fail('timeout')`.

### No DOM
The test must NOT import anything from `@vitejs/*`, `three`, or React. If `LocalVoiceAdapter` uses `setTimeout` internally, either:
- Pass `participantJoinDelay: 0` so the timeout fires immediately after an `await Promise.resolve()`, OR
- Use `vi.useFakeTimers()` in `beforeEach` and `vi.runAllTimers()` after `joinRoom` resolves.

## Acceptance Criteria
- [ ] Test file exists at `packages/debug-app/src/__tests__/local-stack-integration.test.ts`.
- [ ] `pnpm --filter @officexr/debug-app test` runs the test (it may fail before Task 06's wiring is complete — that is expected).
- [ ] After Tasks 01–07 are complete, `pnpm --filter @officexr/debug-app test` passes with both tests green.
- [ ] Test does not import anything from `three`, `react`, `react-dom`, or `@vitejs/*`.
- [ ] Test completes in < 2 seconds.
- [ ] `pnpm --filter @officexr/debug-app typecheck` passes.

## Dependencies
- Depends on: Task 02 (LocalVoiceAdapter), Task 05 (package scaffold + vitest config), Task 07 (BotDriver)
- Blocks: None (test task — validates prior work)

## TDD Mode

This task IS the test. Write the test file first (it will fail RED), then Tasks 06 and onwards make it go GREEN.

### Test Specifications
- **Test file**: `packages/debug-app/src/__tests__/local-stack-integration.test.ts`
- **Test framework**: Vitest
- **Test command**: `pnpm --filter @officexr/debug-app test`

### Tests to Write
1. **bot proximity triggers voice room join**: Steps described above. Expected: `communication.getCurrentRoom()` and `localVoiceAdapter.getCurrentRoom()` both non-null after bot enters bubble.
2. **bot exit triggers voice room leave**: After (1), bot walks away. Expected: both `getCurrentRoom()` return null.

### TDD Process
1. Write the test file — it FAILS (RED) because BotDriver and full stack wiring may not be complete
2. Complete Tasks 06–07 to make it GREEN
3. Run `pnpm --filter @officexr/debug-app test` — both tests green
