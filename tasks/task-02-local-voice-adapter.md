# Task 02: Implement LocalVoiceAdapter in core-refactor

## Objective
Implement `LocalVoiceAdapter` — a concrete `VoiceAdapter` for local/debug mode that tracks state, emits fake remote-participant events, and exposes lifecycle callbacks for audio wiring.

## Context
- Read `tasks/shared-context.md` before starting.
- `VoiceAdapter` interface is in `packages/core-refactor/src/communication/types.ts`. Study it and `MockVoiceAdapter` (`packages/core-refactor/src/communication/mock-voice-adapter.ts`) closely — `LocalVoiceAdapter` follows the same event-emission pattern.
- Task 01 created skeleton files in `packages/core-refactor/src/adapters/`. Fill in `local-voice-adapter.ts` there.
- The factory in Task 01 already imports from this path. Verify the import resolves after this task.

**Quick Context:**
- `VoiceAdapterEvents` defines three event names: `'connection-state-change'`, `'remote-participant-joined'`, `'remote-participant-left'`.
- `VoiceConnectionState` values: `'idle' | 'joining' | 'connected' | 'reconnecting' | 'error'`.
- Tests use `delay: 0` in constructor options to make the `setTimeout` fire synchronously-ish (use `await new Promise(r => setTimeout(r, 0))` in tests to flush the microtask queue).

## Files to Create
- `packages/core-refactor/src/adapters/local-voice-adapter.ts` — implementation
- `packages/core-refactor/src/adapters/local-voice-adapter.test.ts` — TDD tests

## Files to Modify
- `packages/core-refactor/src/adapters/index.ts` — export `LocalVoiceAdapter` (create this barrel if it doesn't exist)
- `packages/core-refactor/src/index.ts` — re-export from `./adapters/index.ts`

## Requirements

### Constructor options
```ts
export interface LocalVoiceAdapterOptions {
  /** Id to use for the fake remote participant. Default: 'bot-001'. */
  fakeParticipantId?: string;
  /** Delay in ms before emitting remote-participant-joined after joinRoom. Default: 300. */
  participantJoinDelay?: number;
  /** Called synchronously when a room is joined (state transitions to 'connected'). */
  onRoomJoined?: (roomId: string) => void;
  /** Called synchronously when leaveRoom is called (state transitions to 'idle'). */
  onRoomLeft?: () => void;
}
```

### State machine
- Initial state: `currentRoom = null`, `connectionState = 'idle'`
- `joinRoom(roomId)` with `roomId === null`: calls `leaveRoom()` and returns
- `joinRoom(roomId)` with a non-null roomId already current: no-op
- `joinRoom(roomId)` with a new non-null roomId:
  1. Set `connectionState` to `'joining'`, emit `connection-state-change`
  2. Set `currentRoom = roomId`, `connectionState = 'connected'`, emit `connection-state-change`
  3. Call `onRoomJoined(roomId)` if provided
  4. Schedule `setTimeout(() => emit 'remote-participant-joined', delay)` where delay defaults to 300
- `leaveRoom()`:
  1. If no `currentRoom`, no-op
  2. Emit `remote-participant-left` for `fakeParticipantId` (if one was previously "joined")
  3. Set `currentRoom = null`, `connectionState = 'idle'`, emit `connection-state-change`
  4. Call `onRoomLeft()` if provided
- `setMuted(muted)`: no-op (store the value; `getMuted()` is not part of the interface)
- `dispose()`: clear all handlers; cancel pending timeouts

### Event emission pattern
Follow `MockVoiceAdapter`'s private `fire(name, payload)` pattern exactly:
iterate a `Map<VoiceAdapterEventName, Set<handler>>` to call each registered handler.

### No DOM dependency
`LocalVoiceAdapter` uses `setTimeout` (available in Node.js test environment) but must not
import anything browser-specific. Tests run in `environment: 'node'`.

## Acceptance Criteria
- [ ] `new LocalVoiceAdapter()` starts in `{ currentRoom: null, connectionState: 'idle' }` state.
- [ ] After `await adapter.joinRoom('room-alice')`, `adapter.getCurrentRoom()` returns `'room-alice'` and `adapter.getConnectionState()` returns `'connected'`.
- [ ] `connection-state-change` is emitted with `'joining'` then `'connected'` on `joinRoom`.
- [ ] After `delay: 0` and a microtask flush, `remote-participant-joined` fires with `{ roomId: 'room-alice', participantId: 'bot-001' }`.
- [ ] `onRoomJoined` callback is called synchronously (before the setTimeout fires) with the room id.
- [ ] `await adapter.leaveRoom()` resets `currentRoom` to null, `connectionState` to `'idle'`, emits `remote-participant-left` then `connection-state-change`.
- [ ] `onRoomLeft` callback fires during `leaveRoom()`.
- [ ] Calling `joinRoom('room-alice')` a second time when already in `'room-alice'` is a no-op (no events emitted, no second timeout scheduled).
- [ ] After `dispose()`, no further events are emitted even if the pending timeout fires.
- [ ] `pnpm --filter @officexr/core-refactor test` passes (all existing tests + new adapter tests green).
- [ ] `pnpm --filter @officexr/core-refactor typecheck` passes.

## Dependencies
- Depends on: Task 01 (adapters directory skeleton created there)
- Blocks: Task 06, Task 09, Task 10

## TDD Mode

This task uses Test-Driven Development. Write tests BEFORE implementation.

### Test Specifications
- **Test file**: `packages/core-refactor/src/adapters/local-voice-adapter.test.ts`
- **Test framework**: Vitest
- **Test command**: `pnpm --filter @officexr/core-refactor test`

### Tests to Write
1. **initial state**: `getCurrentRoom()` returns null, `getConnectionState()` returns `'idle'`. Expected: pass.
2. **joinRoom transitions state**: after `joinRoom('room-alice')`, `getCurrentRoom() === 'room-alice'`, `getConnectionState() === 'connected'`. Expected: pass.
3. **joinRoom emits connection-state-change events**: listener receives `'joining'` then `'connected'`. Expected: listener called twice in order.
4. **joinRoom fires remote-participant-joined after delay=0**: `await new Promise(r => setTimeout(r, 0))` then check listener was called with correct payload. Expected: pass.
5. **onRoomJoined callback fires synchronously**: spy on callback; after `await joinRoom(...)`, callback already invoked before awaiting setTimeout. Expected: pass.
6. **leaveRoom resets state and emits events**: after join then `leaveRoom()`, `getCurrentRoom()` null, `getConnectionState()` idle, `remote-participant-left` emitted. Expected: pass.
7. **onRoomLeft callback fires during leaveRoom**: Expected: pass.
8. **double joinRoom same room is no-op**: join same room twice; verify `connection-state-change` emitted only the initial two times. Expected: pass.
9. **dispose cancels pending timeout**: call `joinRoom` with `delay: 10000`, then `dispose()`; advance timer via `vi.useFakeTimers()` — handler must NOT be called. Expected: pass.

### TDD Process
1. Write the tests above — they should FAIL (RED)
2. Implement `LocalVoiceAdapter` in `local-voice-adapter.ts` (GREEN)
3. Run `pnpm --filter @officexr/core-refactor test`
4. Refactor if needed while keeping all tests green
