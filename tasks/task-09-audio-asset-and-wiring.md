# Task 09: Bundle elevator-music audio asset and wire playback to LocalVoiceAdapter

## Objective
Place a small looping MP3 in `packages/debug-app/public/` and wire `LocalVoiceAdapter`'s `onRoomJoined`/`onRoomLeft` callbacks to start and stop audio playback.

## Context
- Read `tasks/shared-context.md` before starting.
- `LocalVoiceAdapter` (Task 02) exposes `onRoomJoined?: (roomId: string) => void` and `onRoomLeft?: () => void` in its constructor options. These are already passed via `createStack` (Task 01) when the debug page constructs its local stack (Task 06).
- The audio element is created in `DebugOfficePage`'s `useEffect` alongside the rest of the stack.
- Task 06 already has a placeholder audio wiring block (`const audio = new Audio('/elevator-music.mp3')`). This task completes it by ensuring the file exists.

**Quick Context:**
- Audio file destination: `packages/debug-app/public/elevator-music.mp3`
- Vite serves files in `public/` at the root path: `new Audio('/elevator-music.mp3')` resolves correctly during dev and after `vite build`.
- The audio wiring code in `DebugOfficePage` (Task 06) already calls `audio.play()` in `onRoomJoined` and `audio.pause()` in `onRoomLeft`. Verify this is correct and complete.

## Files to Create / Add
- `packages/debug-app/public/elevator-music.mp3` — royalty-free looping audio (< 100 KB)

## Files to Verify / Modify
- `packages/debug-app/src/DebugOfficePage.tsx` — confirm audio element setup and callback wiring match the spec below

## Requirements

### Finding or creating the audio file
Option A (preferred): Download a royalty-free short loop from a public-domain source (e.g., Freesound.org CC0 track, exported as MP3, trimmed to < 30 s, < 100 KB).

Option B: Generate a simple synthetic audio file programmatically using `ffmpeg` if available:
```bash
ffmpeg -f lavfi -i "sine=frequency=440:duration=5" -ac 1 -ar 22050 -b:a 32k \
  packages/debug-app/public/elevator-music.mp3
```
This produces a 5-second 440 Hz sine loop at ~20 KB. Functional, not pretty.

Use whichever method is available. The file must:
- Be a valid MP3 decodable by `HTMLAudioElement`
- Be ≤ 100 KB
- Loop cleanly when `audio.loop = true`

### Audio element setup in `DebugOfficePage`
```ts
const audio = new Audio('/elevator-music.mp3');
audio.loop = true;
audio.volume = 0.4;
```

### Callback wiring (passed to `createStack`)
```ts
onRoomJoined: (_roomId: string) => {
  audio.play().catch((err) => {
    console.warn('[debug-app] audio autoplay blocked:', err);
  });
},
onRoomLeft: () => {
  audio.pause();
  audio.currentTime = 0;
},
```

### Cleanup
In the `useEffect` cleanup:
```ts
audio.pause();
audio.src = ''; // release media resource
```

## Acceptance Criteria
- [ ] `packages/debug-app/public/elevator-music.mp3` exists and is a valid MP3 ≤ 100 KB.
- [ ] `pnpm --filter @officexr/debug-app dev` serves `/elevator-music.mp3` (verify with `curl http://localhost:5174/elevator-music.mp3`).
- [ ] When the bot walks into proximity and `LocalVoiceAdapter.onRoomJoined` fires, `audio.play()` is called (verify by observing the browser's audio indicator or logging).
- [ ] When the bot walks away and `LocalVoiceAdapter.onRoomLeft` fires, `audio.pause()` is called.
- [ ] An autoplay-blocked console warning is logged rather than an uncaught error if the browser blocks autoplay.
- [ ] `pnpm --filter @officexr/debug-app typecheck` passes.

## Dependencies
- Depends on: Task 02 (LocalVoiceAdapter callbacks), Task 06 (DebugOfficePage audio wiring placeholder)
- Blocks: None
