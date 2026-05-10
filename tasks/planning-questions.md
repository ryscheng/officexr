# Planning Questions

## Codebase Summary

### What exists in `packages/sdk`
The SDK is substantially complete. It contains:
- `game-state/`: Full `OfficeState` type, Zustand-backed `Store`, typed `Bus`, `Actions`, `RuleRegistry`, `proximityRule`, `attachProximityReducer`, `serializeOfficeState`/`applySnapshot`
- `realtime/`: Complete `NetEvent` protocol with Zod validation, `SyncEngine` (outbound throttling + stop-packet, inbound dedup, version-warning), `SnapshotHandshake` (request/offer/retry/drain), `InMemoryChannel` + `createInMemoryChannelHub`, `SupabaseChannel`
- `data/`: `PersistenceAdapter` interface, `MemoryPersistenceAdapter` — **no Supabase implementation yet**
- `test-harness/`: `createMultiClientHarness`, `FakeClock`, `TwoClientHarness` — all working

### What exists in `packages/core-refactor`
Significantly smaller scope than the SDK. Contains only:
- `communication/types.ts` — `VoiceAdapter` interface, `VoiceConnectionState`, `VoiceAdapterEvents`
- `communication/communication.ts` — Headless `Communication` class (proximity → lex-min room → `VoiceAdapter.joinRoom`)
- `communication/jitsi-room.ts` — `deriveJitsiRoom` (lex-min room seed logic)
- `communication/mock-voice-adapter.ts` — Test-only `MockVoiceAdapter`

The package is named `@officexr/core-refactor` and is a library-only package — no renderer, no HUD, no React, no app wiring. It has tests covering `Communication`, `deriveJitsiRoom`, and an integration test confirming two-client proximity-to-voice-room routing.

### What is missing vs the refactor-plan
From refactor-plan steps 1–11, the following are absent or incomplete:

| Refactor-plan step | Status |
|----|---|
| S1: `@officexr/sdk` carved out | Done |
| S2: `OfficeState` types + store skeleton | Done |
| S3: Zombie subsystem on store | Not done (no `ZombieGame` logic, no `zombie:state` outbound in sync) |
| S4: Pull THREE out of `usePresence` | Not done (old `core` still has THREE-tangled hooks) |
| S5: Extract `communication/` subtree | Partially done — headless `Communication` class exists; no React wrapper, no JaaS `VoiceAdapter` implementation |
| S6: NetEvent protocol | Done (protocol.ts, sync.ts) — missing `whiteboard:clear/undo`, `screen:*`, `bubble:prefs`, `loot:open`, `net:ping/pong` kinds |
| S7: `sync.ts` + snapshot handshake | Done |
| S8: inventory → Postgres | Not done — `MemoryPersistenceAdapter` exists but no Supabase `PersistenceAdapter` |
| S9: Shrink `RoomScene` → `RoomPage` | Not done — `RoomScene.tsx` is still 1300+ lines |
| S10: Mobile parity on SDK | Not done — `mobile/src/lib/supabase.ts` and `mobile/src/hooks/useAuth.ts` still duplicated |
| S11: Convergence + rule tests | Partial — bus, store, rule unit tests exist; convergence integration tests exist in SDK |

**Critical gap for this PRD**: There is no concrete `VoiceAdapter` implementation for production (JaaS/JaaSMeeting) or for local debugging. The `Communication` class is wired to a `VoiceAdapter` interface but no implementations ship beyond `MockVoiceAdapter` (test-only). The `local` mode asked for in this PRD maps directly to the missing "local `VoiceAdapter`" and "local `Channel`" (which does exist as `InMemoryChannel` in the SDK).

### Realtime layer
`InMemoryChannel` and `createInMemoryChannelHub` are already in `packages/sdk/src/realtime/channel.ts` and implement the full `Channel` interface. They are already used extensively in tests and the multi-client harness. No gap for the signaling side of "local mode."

`SupabaseChannel` is in `packages/sdk/src/realtime/supabase-channel.ts` and also implements `Channel` fully.

There is **no factory / provider pattern** yet — callers must construct either directly. A `createChannel(config)` factory is not present.

### JaaS/audio-video
JaaS is wired via `@jitsi/react-sdk`'s `<JaaSMeeting>` component in `packages/core/src/components/room/JitsiMeetingContainer.tsx`. The `useJitsi` hook manages JWT generation (via `lib/jaasJwt.ts`), mic monitoring, mute, room management, and proximity-based room switching. This is all in the old `core` and has no counterpart in `core-refactor` — only the interface (`VoiceAdapter`) and its orchestrator (`Communication`) exist there.

The minimum `VoiceAdapter` surface is already defined in `types.ts`: `joinRoom`, `leaveRoom`, `setMuted`, `getCurrentRoom`, `getConnectionState`, `on(event)`, `dispose`. A JaaS implementation would wrap `JaaSMeeting` behind this interface.

### App entry points
The web app routes are in `packages/core/src/App.tsx` (BrowserRouter with `/`, `/login`, `/room/:id`). The web shell at `packages/web` is a thin Vite wrapper pointing `@` aliases at `packages/core/src`. There is no existing dev/debug route — adding `/debug` or `/local` would require adding a route in `App.tsx`.

The web package has no dependency on `@officexr/sdk` or `@officexr/core-refactor` — it only depends on `@officexr/core` (old package).

### Proximity / spatial audio
Proximity is computed in `packages/sdk/src/game-state/rules/proximity.ts` (`proximityRule`), which fires `proximity:entering` / `proximity:exiting` bus events. `BUBBLE_RADIUS = 3` (XZ plane distance). The `Communication` class reacts to those events to join/leave JaaS rooms. The renderer reads `OfficeState.proximity` to show bubble spheres. A fake participant only needs to be present in `OfficeState.players` with a valid `pos` so the proximity rule fires correctly against it — no special wiring is needed.

---

## Questions

### Q1: Interface split — one `RealtimeProvider` or separate `Channel` and `VoiceAdapter`?
**Context:** The SDK already has a clean `Channel` interface covering signaling (send, receive NetEvents, track presence, list present). `core-refactor` already has `VoiceAdapter` covering audio/video. The two are already separate and independently tested. Merging them into a single `RealtimeProvider` would mean `Channel` gains audio methods, which would violate the SDK's "no DOM, no MediaStream" constraint (SDK is React-free / browser-free by design).

**Question:** Should the interface stay split as it is today — `Channel` in the SDK for signaling, `VoiceAdapter` in `core-refactor` for audio/video — or do you want a single top-level `RealtimeProvider` type that bundles both, even if it lives outside the SDK?

**Options:**
- A) Keep the split: `Channel` (signaling, in SDK) + `VoiceAdapter` (audio/video, in `core-refactor`). A `LocalMode` config passes `InMemoryChannel` + a new `LocalVoiceAdapter`. This matches the existing architecture exactly.
- B) Add a thin `RealtimeProvider` wrapper type in `core-refactor` that composes a `Channel` + `VoiceAdapter` and is selected at startup by a single config object. The internals remain split.
- C) Collapse into one interface. This would require moving it into `core-refactor` (not SDK) since it would touch browser APIs.

### Q2: How invasive should the migration be for the web app?
**Context:** The web app currently imports everything from `@officexr/core` (old package). The refactored architecture lives in `@officexr/sdk` and `@officexr/core-refactor`. For the local debug office to use the new `Communication` + `VoiceAdapter` stack, the web app needs to at minimum import from the new packages for the debug route. Switching the production `/room/:id` route is a larger, riskier change.

**Question:** Should the migration be scoped to only the local debug route for now (new code path, old `/room/:id` untouched), or do you want to also wire `/room/:id` to the new SDK + `core-refactor` stack as part of this work?

**Options:**
- A) Debug route only (`/local` or `/debug`). Old `RoomScene` is untouched. New stack is used exclusively for the local debug office. Migration of `/room/:id` is deferred.
- B) Switch `/room/:id` to the new stack simultaneously. Means completing steps S4, S5, S9 from the migration plan (pull THREE out of hooks, extract `Communication`, shrink `RoomScene`). Significantly larger scope.
- C) Feature-flag approach: a single env var (`VITE_USE_NEW_STACK=true`) switches `/room/:id` between old and new stack. Both code paths maintained in parallel.

### Q3: Scope of the local debug office
**Context:** The local debug mode needs a fully rendered office (Three.js scene, HUD, proximity sensing) without Supabase or JaaS. The web app's current renderer lives inside `RoomScene.tsx` and is deeply coupled to the old `core` hooks. There is no standalone `WorldRenderer` or app-layer package yet.

**Question:** What is the minimal acceptable renderer for the local debug office?

**Options:**
- A) Reuse the existing `RoomScene` directly: just pass a no-op Supabase channel (`InMemoryChannel` over a hub) and a `LocalVoiceAdapter`. The old `core` rendering code runs unchanged. Quickest path but leaves the old architecture in place.
- B) Implement a minimal new `DebugRoom` component using the new SDK store + `Communication` class, but reuse the existing Three.js scene-setup code (copy/extract the relevant parts from `useSceneSetup`). Medium effort, but produces a real preview of the target architecture.
- C) Full `WorldRenderer` as described in the refactor-plan (completely separate from `RoomScene`). Largest scope; only makes sense if Q2 answer is B.

### Q4: Fake participant wiring
**Context:** The proximity rule fires based on `OfficeState.players[*].pos`. A fake participant is simply a player entry in the store with a controlled position. No special realtime wiring is needed since the local debug mode uses `InMemoryChannel` — the fake participant can be a second client on the same hub, or it can be injected directly into the store by a "bot" that calls `actions.upsertPlayer()` and periodically updates its position.

**Question:** Should the fake participant be:

**Options:**
- A) A fully simulated second client: creates its own store + `SyncEngine` + `InMemoryChannel` connected to the same hub. Realistic behavior (it will appear in presence lists, respond to snapshot requests, etc.). Uses the existing `createMultiClientHarness` pattern from the SDK test harness.
- B) A simple "bot" that directly calls `actions.upsertPlayer({ id: 'fake-bot', pos: ... })` on the real client's store + periodically moves. Simpler — no second client, no snapshot exchange, but presence lists will show the bot as a "ghost" (won't respond to snapshot requests). Fine if the local debug office skips the snapshot handshake.
- C) A bot that starts far away and slowly walks toward the local user, stopping inside the bubble to trigger proximity events, then walks away. Same implementation as A or B but with scripted movement baked in as the default behavior.

### Q5: Elevator-music audio for the fake participant
**Context:** The goal is to test proximity-based audio attenuation by ear. The simplest DOM-level approach is an `HTMLAudioElement` whose `volume` is set proportionally to proximity distance (no WebRTC, no `MediaStream` required). A small looping audio asset would need to be included in the bundle or fetched from a public URL.

**Question:** Is bundling a small (< 100 KB) audio file in the web package acceptable, or should the audio be synthesized at runtime (Web Audio API oscillator loop), or fetched from a public CDN URL?

**Options:**
- A) Bundle a small MP3/OGG file in `packages/web/public/`. Clean, offline-capable, no runtime synthesis.
- B) Synthesize with Web Audio API (e.g., a 440 Hz sine wave at low gain). Zero bundle cost; sounds robotic but functional.
- C) Fetch from a public CDN (e.g., a royalty-free elevator music URL). No bundle cost but requires network access.
- D) No audio at all in the first pass. The fake participant exists and triggers proximity events, but the audio attenuation test is deferred.

### Q6: `LocalVoiceAdapter` — what should it do?
**Context:** `VoiceAdapter` has: `joinRoom`, `leaveRoom`, `setMuted`, `getCurrentRoom`, `getConnectionState`, `on(event)`, `dispose`. For the local debug office, the adapter must satisfy the `Communication` class without a JaaS connection. It can optionally play audio from the fake participant's position.

**Question:** Which behaviors should `LocalVoiceAdapter` actually implement vs stub?

**Options:**
- A) Full stub: all methods no-op except state tracking (`getCurrentRoom`, `getConnectionState`). No audio. Useful for testing proximity room-switching logic in isolation.
- B) Stub + spatial audio: plays an `HTMLAudioElement` loop when a remote participant joins the same room; adjusts volume based on proximity distance received via the bus or a callback. The fake participant triggers this when it enters the bubble.
- C) Stub + spatial audio + fake participant events: `joinRoom` automatically emits `remote-participant-joined` for the fake participant after a short delay, simulating a real peer. Lets the HUD show a participant count.

### Q7: Where does the local debug entry point live?
**Context:** The web app has routes in `packages/core/src/App.tsx`. The debug route would need to render a room without Supabase/JaaS auth. The question is whether it's a new route in the existing app or a completely separate dev-only entry point.

**Question:** Should the local debug office be:

**Options:**
- A) A new `/local` route added to `packages/core/src/App.tsx`. Accessible at `http://localhost:5173/local` when running `pnpm dev`. Visible in the existing React app tree with no separate server.
- B) A separate Vite entry point in `packages/web` (e.g., `debug.html` + `debug.tsx`). Completely isolated from the main app bundle; no shared React router state.
- C) A separate pnpm package (`packages/debug-app`) with its own `vite.config.ts`. Cleanest isolation but most setup effort.

### Q8: TDD mode
**Context:** The SDK already has Vitest-based tests (`vitest.config.ts` in both `packages/sdk` and `packages/core-refactor`). Test files use the `*.test.ts` naming convention alongside source files. The test commands are `pnpm test` (in each package) or `vitest run`.

**Question:** Do you want TDD mode for this build? If yes, the task implementer will write failing tests before implementation code for each task — for example, writing tests for `LocalVoiceAdapter` before implementing it, and tests for the debug route before wiring it up.
