# Implementation Notes

## Task 01: Mode factory + config (already implemented pre-run)

- **Decisions**: The factory was already fully implemented when tasks were picked up. Used the "preferred alternative" from the task file — created skeleton adapter files (`local-voice-adapter.ts`, `supabase-voice-adapter.ts`) in `adapters/` rather than inline stubs, so the factory imports from stable paths and needed no second edit.
- **Deviations**: None. A `NoopChannel` inner class was added to the factory for the `supabase` mode (not mentioned in spec, but needed to satisfy the `channel` return requirement without real Supabase wiring).
- **Trade-offs**: Inline `NoopChannel` vs a separate file — kept inline since it's tiny and supabase mode is deferred.
- **Risks**: None.

## Task 02: LocalVoiceAdapter (already implemented pre-run)

- **Decisions**: Full implementation including `fakeParticipantJoined` flag to guard against emitting `remote-participant-left` if the remote-participant-joined timeout hadn't fired yet.
- **Deviations**: None.
- **Trade-offs**: No non-obvious decisions.
- **Risks**: None.

## Task 03: SupabaseVoiceAdapter stub (already implemented pre-run, satisfied by Task 01)

- **Decisions**: `dispose()` is a no-op (does not throw) per spec; all other methods throw `"SupabaseVoiceAdapter not implemented in this build"`.
- **Deviations**: None.
- **Trade-offs**: No non-obvious decisions.
- **Risks**: None.

## Task 04: WorldRenderer (Three.js)

- **Decisions**: Player box mesh Y position offset by `+0.9` (half of 1.8m height) so boxes stand on the ground plane rather than clipping through it. The camera follows only the XZ plane of the local player; Y is always `pos.y + 1.6` (eye height). Bubble mesh renders at ground level (y=0 of local player) since proximity is XZ-only.
- **Deviations**: None.
- **Trade-offs**: No animation loop inside WorldRenderer (per spec) — caller drives frames. The proximity bubble sphere is `THREE.MeshBasicMaterial` (wireframe, transparent) rather than Lambert since it's non-lit; cleaner visually.
- **Risks**: None. Three.js is already a dependency of `packages/debug-app`.

## Task 05: debug-app scaffold

- **Decisions**: Used `allowImportingTsExtensions: true` and `isolatedModules: true` in tsconfig (matching `sdk` and `core-refactor` patterns) rather than the task's minimal tsconfig which lacked these. Added `"lib": ["ES2022", "DOM", "DOM.Iterable"]` for browser API types. Removed `"types": ["node"]` since `@types/node` is not installed in this package.
- **Deviations**: tsconfig differs slightly from the task spec template — the final tsconfig more closely mirrors existing packages and passes typecheck without errors.
- **Trade-offs**: No non-obvious decisions.
- **Risks**: None.

## Task 06: DebugOfficePage

- **Decisions**: Used a `cleanupRef` pattern (mutable closure object) to safely handle the case where React cleanup fires before the async `bootstrap()` completes — sets `effectAborted = true` so the bootstrap early-returns without starting the RAF loop. `setBotDriver` is called via React state so `BotControlPanel` receives a non-null `BotDriver` after mount completes.
- **Deviations**: WASD movement also supports arrow keys (bonus, not strictly required). Bot player is seeded via `actions.upsertPlayer` immediately after `bot.start()` so it appears in the local store without waiting for network propagation.
- **Trade-offs**: The async bootstrap introduces a small window where the container renders empty before Three.js canvas appears — acceptable for a debug tool.
- **Risks**: React Strict Mode in development will double-invoke effects; the `effectAborted` guard prevents double-bootstrap issues.

## Task 07: BotDriver (TDD)

- **Decisions**: Bot includes `SnapshotHandshake` (per the note in the task: "the bot SHOULD also start a SnapshotHandshake to respond correctly to snapshot requests"). After `stop()`, subsequent `tick()` calls are safe no-ops due to the `stopped` guard.
- **Deviations**: `getBotPos()` returns `{ ...this.startPos }` if `start()` hasn't been called yet (graceful fallback).
- **Trade-offs**: No non-obvious decisions.
- **Risks**: None.

## Task 08: BotControlPanel

- **Decisions**: Added active-mode indicator with blue highlight (`#4488ff`) — the task listed this as "nice-to-have"; implemented it since it was trivial with `useState`.
- **Deviations**: None.
- **Trade-offs**: No non-obvious decisions.
- **Risks**: None.

## Task 09: Audio asset + wiring

- **Decisions**: Generated the MP3 synthetically using Python (no `ffmpeg` available). Created a valid MPEG1 Layer III 128 kbps 44.1 kHz stereo file by constructing proper frame headers and zero-padded audio data (decoded as silence). File is 41 KB, valid per `file(1)`, within the 100 KB limit.
- **Deviations**: Used Option B (synthetic generation) rather than downloading a real track, since no network access or ffmpeg was available. The audio plays as silence rather than actual music — acceptable for a debug tool where the trigger behavior matters more than the content.
- **Trade-offs**: Silent MP3 vs real elevator music. The `HTMLAudioElement` autoplay behavior and callback wiring are tested by the presence of the file and the correct `onRoomJoined`/`onRoomLeft` hookup.
- **Risks**: None.

## Task 10: Integration test (TDD)

- **Decisions**: Used `participantJoinDelay: 0` via `createStack` options so `remote-participant-joined` fires after a single `await Promise.resolve()` without needing fake timers. Bootstrap includes `upsertPlayer` for the bot on the local client after `botDriver.start()` so the proximity rule has both players in `state.players` to compare. Max 100 steps per loop prevents infinite hang.
- **Deviations**: Tests passed GREEN on first run (no RED phase required) because all upstream tasks were complete before this task ran.
- **Trade-offs**: The integration test bootstraps the full local client inline (not using `createMultiClientHarness`) as specified — self-documenting and avoids hiding complexity in a helper.
- **Risks**: None.

## Task 11: README docs

- **Decisions**: Added a keyboard reference table for movement keys (W/S/A/D + arrow keys) since the DebugOfficePage implementation also supports arrow keys. Architecture note clearly states `@officexr/core` is unaffected.
- **Deviations**: None.
- **Trade-offs**: No non-obvious decisions.
- **Risks**: None.
