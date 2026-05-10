# Task 11: Add dev docs for debug-app

## Objective
Write a short README in `packages/debug-app/` explaining how to start the debug app, what it demonstrates, and how to use the bot controls.

## Context
- Read `tasks/shared-context.md` before starting.
- This is documentation only — no code changes.
- Write after Tasks 05–09 are complete so the README reflects the actual running state.

**Quick Context:**
- File: `packages/debug-app/README.md`
- The repo-level `README.md` does not need updating unless the team agrees — the per-package README is sufficient for now.

## Files to Create
- `packages/debug-app/README.md`

## Requirements

The README must cover:

### Start the debug app
```
pnpm --filter @officexr/debug-app dev
```
Then open `http://localhost:5174` in a browser.

### What it demonstrates
- Local-mode proximity detection (no Supabase, no JaaS, no auth)
- Fake bot participant simulating a second user
- Voice-room routing via `Communication` class (proximity → lex-min room derivation)
- Audio playback triggered by `LocalVoiceAdapter` callbacks (requires user gesture to unblock autoplay)

### Bot controls
- **Stay** — bot stands still
- **Walk to me** — bot moves toward the local player at 1.5 m/s
- **Walk away** — bot moves away from the local player

### Movement controls
WASD keys move the local player.

### Running tests
```
pnpm --filter @officexr/debug-app test
pnpm --filter @officexr/core-refactor test
```

### Architecture note
One paragraph noting that this debug app uses the new `@officexr/sdk` + `@officexr/core-refactor` stack exclusively, and that `@officexr/core` (production app) is not affected.

## Acceptance Criteria
- [ ] `packages/debug-app/README.md` exists and contains all sections above.
- [ ] The start command is accurate (`pnpm --filter @officexr/debug-app dev`).
- [ ] The README does not contain any hardcoded environment-specific paths or secrets.

## Dependencies
- Depends on: Task 05 (package exists), Tasks 06–09 (features documented)
- Blocks: None
