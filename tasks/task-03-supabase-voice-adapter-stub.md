# Task 03: Add SupabaseVoiceAdapter stub (deferred/optional)

## Objective
Add a compilable `SupabaseVoiceAdapter` stub that satisfies the `VoiceAdapter` interface and makes the factory's `'supabase'` branch a non-error, while deferring real JaaS integration.

## Context
- Read `tasks/shared-context.md` before starting.
- The existing JaaS wiring lives in `packages/core/src/hooks/useJitsi.ts` and
  `packages/core/src/components/room/JitsiMeetingContainer.tsx`. That code is tightly
  coupled to React hooks, Supabase channel refs, and JWT generation (`@/lib/jaasJwt`).
  Wrapping it behind `VoiceAdapter` is a substantial effort (outside scope of this build).
- This task's goal is ONLY to make the factory compile without a real JaaS implementation.
- The skeleton created by Task 01 in `packages/core-refactor/src/adapters/supabase-voice-adapter.ts`
  needs to be filled with a throw-on-call stub, not a real implementation.

**Quick Context:**
- `VoiceAdapter` interface: `packages/core-refactor/src/communication/types.ts`
- Adapter location (from Task 01 skeleton): `packages/core-refactor/src/adapters/supabase-voice-adapter.ts`
- This is marked **optional/deferred**. If Task 01 already placed a sufficient inline stub in the factory, this task can be skipped. Check whether the acceptance criteria below are already met before starting.

## Files to Modify
- `packages/core-refactor/src/adapters/supabase-voice-adapter.ts` — fill skeleton with stub implementation

## Requirements

```ts
export class SupabaseVoiceAdapter implements VoiceAdapter {
  async joinRoom(_roomId: string | null): Promise<void> {
    throw new Error('SupabaseVoiceAdapter not implemented in this build');
  }
  async leaveRoom(): Promise<void> {
    throw new Error('SupabaseVoiceAdapter not implemented in this build');
  }
  setMuted(_muted: boolean): void {
    throw new Error('SupabaseVoiceAdapter not implemented in this build');
  }
  getCurrentRoom(): string | null {
    throw new Error('SupabaseVoiceAdapter not implemented in this build');
  }
  getConnectionState(): VoiceConnectionState {
    throw new Error('SupabaseVoiceAdapter not implemented in this build');
  }
  on<K extends VoiceAdapterEventName>(
    _name: K,
    _handler: (payload: VoiceAdapterEvents[K]) => void,
  ): () => void {
    throw new Error('SupabaseVoiceAdapter not implemented in this build');
  }
  dispose(): void {
    // no-op stub; safe to call without error so cleanup code doesn't throw
  }
}
```

- `dispose()` should NOT throw (cleanup code may always call it).
- All other methods throw the `"not implemented"` error.

## Acceptance Criteria
- [ ] `SupabaseVoiceAdapter` class is exported from `packages/core-refactor/src/adapters/supabase-voice-adapter.ts`.
- [ ] Calling `new SupabaseVoiceAdapter().joinRoom('x')` throws `Error` with message `"SupabaseVoiceAdapter not implemented in this build"`.
- [ ] Calling `new SupabaseVoiceAdapter().dispose()` does NOT throw.
- [ ] `pnpm --filter @officexr/core-refactor typecheck` passes (the class satisfies `VoiceAdapter`).
- [ ] `pnpm --filter @officexr/core-refactor test` passes (existing tests unaffected; no new test file required for this stub).

## Dependencies
- Depends on: Task 01 (adapters directory + skeleton file created)
- Blocks: Task 05 (factory needs this to compile cleanly)
