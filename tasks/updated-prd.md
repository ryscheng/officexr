# Updated PRD — Local Debug Office (OfficexR)

## Overview

Build a standalone local debug entry point (`packages/debug-app`) that wires together
the new `@officexr/sdk` + `@officexr/core-refactor` stack with no Supabase, no JaaS,
and no authentication. The primary goal is a working development sandbox where proximity
detection, voice-room routing, and audio playback can be exercised end-to-end in a
browser — and tested headlessly in Vitest.

This work is scoped to the debug app only. The existing `@officexr/core` package and its
`/room/:id` route are left completely untouched.

---

## What Already Exists (do not recreate)

| Artifact | Location | Status |
|---|---|---|
| `Channel` interface + `InMemoryChannel` + hub | `packages/sdk/src/realtime/channel.ts` | Complete |
| `SyncEngine` | `packages/sdk/src/realtime/sync.ts` | Complete |
| `SnapshotHandshake` | `packages/sdk/src/realtime/snapshot-handshake.ts` | Complete |
| `Store`, `Actions`, `Bus`, `RuleRegistry` | `packages/sdk/src/game-state/` | Complete |
| `proximityRule`, `attachProximityReducer` | `packages/sdk/src/game-state/rules/` + `reducers/` | Complete |
| `createMultiClientHarness`, `FakeClock` | `packages/sdk/src/test-harness/` | Complete |
| `VoiceAdapter` interface, `VoiceAdapterEvents` | `packages/core-refactor/src/communication/types.ts` | Complete |
| `Communication` class | `packages/core-refactor/src/communication/communication.ts` | Complete |
| `deriveJitsiRoom` | `packages/core-refactor/src/communication/jitsi-room.ts` | Complete |
| `MockVoiceAdapter` (test-only) | `packages/core-refactor/src/communication/mock-voice-adapter.ts` | Complete |

---

## What Needs to Be Built

### 1. Mode Factory (`core-refactor`)

A typed factory function in `packages/core-refactor/src/factory/` that returns
`{ channel: Channel, voiceAdapter: VoiceAdapter }` pairs:

- `createLocalStack({ hub, selfId })` — returns `{ channel: InMemoryChannel, voiceAdapter: LocalVoiceAdapter }`
- `createSupabaseStack(config)` — stub that throws `"SupabaseVoiceAdapter not implemented"` at runtime; satisfies types so the factory's `'supabase'` branch compiles

The two interfaces (`Channel` from SDK, `VoiceAdapter` from `core-refactor`) remain separate;
the factory just selects concrete pairs. Callers pass `mode: 'local' | 'supabase'` to a
top-level `createStack(config)` dispatcher.

### 2. `LocalVoiceAdapter` (`core-refactor`)

A concrete `VoiceAdapter` implementation for local-mode use:

- Tracks `currentRoom` and `connectionState` with real state transitions
  (`idle` → `joining` → `connected` on joinRoom; back to `idle` on leaveRoom)
- After `joinRoom(roomId)` with a non-null roomId, emits `remote-participant-joined`
  for a configurable fake participant id (default `'bot-001'`) after a configurable delay
  (default 300 ms). The delay uses the real `setTimeout` (not FakeClock) because the
  adapter runs in the browser; tests can pass `delay: 0` to make it synchronous.
- `leaveRoom()` emits `remote-participant-left` and resets state to idle
- Accepts optional lifecycle callbacks in its constructor options:
  `onRoomJoined?: (roomId: string) => void` and `onRoomLeft?: () => void`
  These are called synchronously at the moment the state transitions (before the timer fires),
  so the debug app can start/stop audio immediately.
- No DOM dependency in the adapter itself

### 3. `SupabaseVoiceAdapter` stub (`core-refactor`)

A minimal stub class that compiles and throws
`"SupabaseVoiceAdapter not implemented in this build"` from every method.
Lives alongside `LocalVoiceAdapter` in `packages/core-refactor/src/adapters/`.
Used by the factory's `'supabase'` branch.

### 4. `WorldRenderer` module (inside `packages/debug-app`)

A new Three.js rendering class — not imported from `@officexr/core`. Reads `OfficeState`
from the SDK `Store` and renders:

- Player avatars as `BoxGeometry` meshes (one per `players` entry in state)
- Ground plane + ambient + directional lighting
- A first-person `PerspectiveCamera` following `selfId`'s `pos`
- A wireframe `SphereGeometry` of radius `BUBBLE_RADIUS` around the local player

Scene bootstrap is copied (not imported) from the relevant portions of
`packages/core/src/hooks/useSceneSetup.ts` (camera setup, renderer setup, lighting).
Only the Three.js primitives are reused; no old-core hooks or React refs are brought over.

### 5. `packages/debug-app` package scaffold

New pnpm package: `@officexr/debug-app`. Includes:
- `package.json` (`name: "@officexr/debug-app"`, `private: true`, `type: "module"`)
- `vite.config.ts` (React plugin, port 5174 to avoid conflict with `packages/web`)
- `index.html`
- `src/main.tsx` (React root mount)
- `tsconfig.json`
- Added to root `pnpm-workspace.yaml` (already lists `"packages/*"` glob — no change needed)

Run via: `pnpm --filter @officexr/debug-app dev`

Direct dependencies: `@officexr/sdk workspace:*`, `@officexr/core-refactor workspace:*`,
`react`, `react-dom`, `three`.

### 6. Debug Office Page (`DebugOfficePage`)

Single React page component that composes the full local stack:

- Creates hub, store, bus, actions, rules, channels for the local player
- Instantiates `LocalVoiceAdapter` with audio callbacks
- Creates `Communication` + `SyncEngine` + `SnapshotHandshake`
- Mounts `WorldRenderer` into a canvas div via `useEffect`
- Runs tick loop via `requestAnimationFrame`; calls `actions.tick(now)`, `rules.tick(...)`,
  `sync.flushPosition()`, `handshake.tickTimers()` each frame
- No routing, no auth — renders immediately on load

### 7. Fake-Participant Bot Driver

Standalone headless class `BotDriver` in `packages/debug-app/src/bot/`:

- Runs a fully simulated second client (own `Store`, own `SyncEngine`, own `InMemoryChannel`)
  on the same hub passed to it — same pattern as `createMultiClientHarness`
- Exposes `start()`, `stop()`, `tick(dt: number)`, `setMode('idle' | 'walk-to-local' | 'walk-away')`
- `walk-to-local`: each `tick(dt)` nudges the bot's `pos` toward the local player's current
  `pos` getter result at a fixed speed (configurable, default 1.5 m/s)
- `walk-away`: nudges away from local player (opposite direction) until a max distance
- Bot's position is broadcast via its own `SyncEngine` so the local client receives it
  through the normal channel, sees it in `store.getState().players`, and the proximity rule fires

### 8. Bot Control UI

A minimal React overlay panel (position: fixed, bottom-right corner, inline styles only):

- Three buttons: "Stay", "Walk to me", "Walk away"
- Each calls `botDriver.setMode(...)` on the `BotDriver` instance

### 9. Bundled Audio + Playback Wiring

- Place `elevator-music.mp3` (≤ 100 KB royalty-free loop) in `packages/debug-app/public/`
- The debug page creates an `HTMLAudioElement` (`src="/elevator-music.mp3"`, `loop=true`)
- Wire `LocalVoiceAdapter` callbacks:
  - `onRoomJoined`: `audio.play()`
  - `onRoomLeft`: `audio.pause(); audio.currentTime = 0`
- Uniform volume (default 0.4); no spatialization

### 10. Integration Test (written first — TDD)

A Vitest test in `packages/debug-app/src/__tests__/local-stack-integration.test.ts`:

- Spins up the local stack headlessly (no DOM, no canvas, no audio)
- Creates a `BotDriver` on the same hub
- Calls `botDriver.setMode('walk-to-local')` with the local player starting far away
- Steps time forward (using `FakeClock` on the harness; bot's own `tick(dt)` called each step)
  until the bot's distance to the local player drops below `BUBBLE_RADIUS`
- Asserts `communication.getCurrentRoom()` is non-null
- Asserts `localVoiceAdapter.getCurrentRoom()` is non-null

Written before Task 6's integration wiring.

### 11. Dev Docs

`packages/debug-app/README.md` explaining:
- How to start: `pnpm --filter @officexr/debug-app dev`
- What the debug app demonstrates
- Bot controls

---

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Interface split | Kept: `Channel` (SDK) + `VoiceAdapter` (core-refactor) | Preserves SDK DOM-free constraint |
| Factory | Small factory returning `{ channel, voiceAdapter }` pairs | No combined wrapper; consumer passes `mode` |
| Migration scope | Debug app only; old `/room/:id` untouched | Risk containment |
| Renderer | Full `WorldRenderer` built fresh; no import from old core | Investment in target architecture |
| Fake participant | Fully simulated second client on same hub | Realistic presence + snapshot handshake |
| Audio | Bundled MP3 in `public/`; uniform volume | Offline-capable; simple wiring |
| `LocalVoiceAdapter` audio coupling | Callbacks (`onRoomJoined`, `onRoomLeft`) | Keeps adapter DOM-free; debug app owns audio |
| Entry point | New `packages/debug-app` package | Cleanest isolation |
| TDD | Yes for headless logic; skip for renderer/UI | Practical split |
| SupabaseVoiceAdapter | Stub that throws; deferred | Factory compiles; JaaS integration is separate work |

---

## Out of Scope (this build)

- Migrating `/room/:id` to the new stack
- Real JaaS/Supabase VoiceAdapter implementation
- Spatial audio / distance-based attenuation
- Mobile parity
- Zombie subsystem wiring
- Inventory / persistence
- Whiteboard / screen share in debug app
