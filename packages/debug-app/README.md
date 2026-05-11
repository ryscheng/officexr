# @officexr/debug-app

A standalone local debug office that exercises the `@officexr/sdk` + `@officexr/core-refactor` stack in a browser with no Supabase, no JaaS, and no authentication.

## Starting the debug app

```bash
pnpm --filter @officexr/debug-app dev
```

Then open `http://localhost:5174` in a browser.

## What it demonstrates

- **Local-mode proximity detection** — no Supabase, no JaaS, no auth. Two clients share an in-memory channel hub; the proximity rule fires when the players come within `BUBBLE_RADIUS = 3 m` of each other on the XZ plane.
- **Fake bot participant** — `BotDriver` spins up a fully simulated second SDK client (its own `Store`, `SyncEngine`, and `InMemoryChannel`) on the same hub, broadcasting real position messages the same way a network peer would.
- **Voice-room routing via `Communication`** — when the bot enters proximity, `Communication` derives a lex-min room id from the two player ids and calls `LocalVoiceAdapter.joinRoom()`. The adapter fires the `onRoomJoined` callback, which triggers audio playback.
- **Audio playback triggered by `LocalVoiceAdapter` callbacks** — elevator music starts when you enter the bot's proximity bubble and stops when you leave. Browsers may block autoplay on first load; move the local player toward the bot after a user gesture (a key press) to unblock it.

## Bot controls

The **Bot Controls** panel appears in the bottom-right corner of the browser window.

| Button | Action |
|--------|--------|
| **Stay** | Bot stands still in its current position |
| **Walk to me** | Bot moves toward the local player at 1.5 m/s |
| **Walk away** | Bot moves away from the local player |

## Movement controls

Use **WASD** keys (or arrow keys) to move the local player:

| Key | Direction |
|-----|-----------|
| W / Arrow Up | Forward (−Z) |
| S / Arrow Down | Backward (+Z) |
| A / Arrow Left | Left (−X) |
| D / Arrow Right | Right (+X) |

Move toward the grey bot box to trigger proximity detection and audio playback.

## Running tests

```bash
# BotDriver unit tests + integration test (headless, no DOM)
pnpm --filter @officexr/debug-app test

# Factory + LocalVoiceAdapter + Communication tests
pnpm --filter @officexr/core-refactor test
```

## Architecture note

This debug app uses the new `@officexr/sdk` + `@officexr/core-refactor` stack exclusively. It does not import anything from `@officexr/core` (the production React app). The production app is unaffected by this package. The goal of the separation is to let the new headless SDK be developed, tested, and iterated on independently from the legacy Three.js scene setup in `packages/core`.
