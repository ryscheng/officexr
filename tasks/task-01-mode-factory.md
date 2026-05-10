# Task 01: Add mode factory to core-refactor

## Objective
Add a typed `createStack` factory in `@officexr/core-refactor` that returns a `{ channel, voiceAdapter }` pair for `mode: 'local'` and a compilable `'supabase'` stub.

## Context
- Read `tasks/shared-context.md` before starting.
- `Channel` lives in `@officexr/sdk` (`packages/sdk/src/realtime/channel.ts`).
- `VoiceAdapter` lives in `@officexr/core-refactor` (`packages/core-refactor/src/communication/types.ts`).
- The factory must keep the two interfaces separate — it just selects a concrete pair.
- `LocalVoiceAdapter` (Task 02) and `SupabaseVoiceAdapter` stub (Task 03) will be the concrete implementations. The factory file imports them from their paths; since those files do not yet exist, use placeholder `// TODO` stubs within the factory file itself or forward-declare as opaque classes. The test for this task validates the factory return types and mode dispatch, NOT the adapter internals.

**Quick Context:**
- Factory lives at `packages/core-refactor/src/factory/index.ts` (new directory).
- The factory must export from `packages/core-refactor/src/index.ts` so consumers can import from `@officexr/core-refactor`.
- `vitest.config.ts` in `core-refactor` uses `environment: 'node'` — the test runs fine without DOM.

## Files to Create
- `packages/core-refactor/src/factory/index.ts` — factory implementation
- `packages/core-refactor/src/factory/index.test.ts` — TDD tests

## Files to Modify
- `packages/core-refactor/src/index.ts` — re-export the factory
- `packages/core-refactor/package.json` — add `"./factory"` export entry if callers need a sub-path import (optional; top-level re-export may suffice)

## Requirements

### Factory shape
```ts
import type { Channel } from '@officexr/sdk';
import type { VoiceAdapter } from '../communication/types.ts';

export interface LocalStackConfig {
  mode: 'local';
  hub: ReturnType<typeof import('@officexr/sdk').createInMemoryChannelHub>;
  selfId: string;
  /** Delay in ms before LocalVoiceAdapter emits remote-participant-joined. Default 300. */
  participantJoinDelay?: number;
  onRoomJoined?: (roomId: string) => void;
  onRoomLeft?: () => void;
}

export interface SupabaseStackConfig {
  mode: 'supabase';
  // fields can be added later; stub throws regardless
}

export type StackConfig = LocalStackConfig | SupabaseStackConfig;

export interface Stack {
  channel: Channel;
  voiceAdapter: VoiceAdapter;
}

export function createStack(config: StackConfig): Stack { ... }
```

- For `mode: 'local'`: construct an `InMemoryChannel(hub, selfId)` and a `LocalVoiceAdapter` (forward-stub acceptable in Task 01; swap real impl in Task 02).
- For `mode: 'supabase'`: construct a `SupabaseVoiceAdapterStub` that throws `"SupabaseVoiceAdapter not implemented in this build"` from every method.

### In-file stubs (acceptable for Task 01 only)
Because `LocalVoiceAdapter` and `SupabaseVoiceAdapter` are built in Tasks 02–03, Task 01 may place minimal inline stubs inside `factory/index.ts` to make the factory compile and the tests pass. Tasks 02–03 will replace those stubs with real classes in their own files; Task 01's factory code must then be updated to import from the canonical paths.

**Alternative (preferred):** Create `packages/core-refactor/src/adapters/local-voice-adapter.ts` and `packages/core-refactor/src/adapters/supabase-voice-adapter.ts` as empty stub files that export skeleton classes now. Task 02 fills in `LocalVoiceAdapter`; Task 03 fills in `SupabaseVoiceAdapter`. This avoids a second edit to the factory file later.

## Acceptance Criteria
- [ ] `createStack({ mode: 'local', hub, selfId: 'alice' })` returns an object with `channel` (instanceof `InMemoryChannel`) and `voiceAdapter` (instance satisfying `VoiceAdapter` interface).
- [ ] `createStack({ mode: 'supabase' })` returns a `voiceAdapter` whose `joinRoom()` throws `"SupabaseVoiceAdapter not implemented in this build"`.
- [ ] `createStack({ mode: 'supabase' }).channel` is defined (can be a stub channel that no-ops).
- [ ] The factory is re-exported from `packages/core-refactor/src/index.ts` so `import { createStack } from '@officexr/core-refactor'` resolves.
- [ ] `pnpm --filter @officexr/core-refactor test` passes (all existing tests + new factory tests green).
- [ ] `pnpm --filter @officexr/core-refactor typecheck` passes with no type errors.

## Dependencies
- Depends on: None (first task)
- Blocks: Task 02, Task 03, Task 05

## TDD Mode

This task uses Test-Driven Development. Write tests BEFORE implementation.

### Test Specifications
- **Test file**: `packages/core-refactor/src/factory/index.test.ts`
- **Test framework**: Vitest
- **Test command**: `pnpm --filter @officexr/core-refactor test`

### Tests to Write
1. **local mode returns InMemoryChannel**: call `createStack({ mode: 'local', hub, selfId: 'alice' })` and assert `stack.channel` is an instance of `InMemoryChannel`. Expected: passes.
2. **local mode returns VoiceAdapter**: assert `stack.voiceAdapter` has `joinRoom`, `leaveRoom`, `getCurrentRoom`, `getConnectionState`, `on`, `dispose` properties. Expected: all present.
3. **supabase mode voiceAdapter throws on joinRoom**: call `createStack({ mode: 'supabase' })`, then `await stack.voiceAdapter.joinRoom('x')` — expect it to throw with message containing `"not implemented"`. Expected: throws.
4. **supabase mode channel is defined**: assert `createStack({ mode: 'supabase' }).channel` is not null/undefined. Expected: passes.

### TDD Process
1. Write the tests above — they should FAIL (RED)
2. Create skeleton files for adapters so types resolve
3. Implement `createStack` factory logic (GREEN)
4. Run `pnpm --filter @officexr/core-refactor test` — all tests green
5. Refactor if needed while keeping tests green
