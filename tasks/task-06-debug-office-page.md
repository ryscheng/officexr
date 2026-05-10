# Task 06: Implement DebugOfficePage — compose the full local stack

## Objective
Build `DebugOfficePage`, the main React component that wires together Store, SyncEngine, Communication, LocalVoiceAdapter, WorldRenderer, and BotDriver into a working local debug session.

## Context
- Read `tasks/shared-context.md` before starting.
- This task depends on Tasks 01–05 and Task 07 (BotDriver). If Task 07 is not yet complete, use a placeholder `BotDriver` import so the page at least renders; the bot wiring is added in Task 08.
- Study `packages/core-refactor/src/communication/communication.ts` — `Communication` requires `{ selfId, store, actions, bus, voice }` and must have `.start()` called before it processes bus events.
- Study `packages/sdk/src/test-harness/two-client.ts` for the pattern of bootstrapping a full client (store → actions → bus → channel → rules → sync → handshake → subscribe → trackPresence → sync.start() → handshake.start()).

**Quick Context:**
- Replace `packages/debug-app/src/App.tsx` placeholder from Task 05 with `DebugOfficePage`.
- The tick loop uses `requestAnimationFrame`; on each frame: `actions.tick(now)`, `rules.tick(current, prev, bus)`, `sync.flushPosition()`, `handshake.tickTimers()`, `botDriver.tick(dt)`, `worldRenderer.render(store.getState())`.
- `SELF_ID = 'local-player'` and `BOT_ID = 'bot-001'` as module-level constants.
- The local player starts at position `{ x: 0, y: 0, z: 0 }`; the bot starts at `{ x: 10, y: 0, z: 0 }` (outside `BUBBLE_RADIUS = 3`).

## Files to Modify
- `packages/debug-app/src/App.tsx` — replace placeholder with `DebugOfficePage`

## Files to Create
- `packages/debug-app/src/DebugOfficePage.tsx` — main page component (App.tsx imports and renders this)

## Requirements

### Stack bootstrap (inside `useEffect(() => { ... }, [])`)
```
1. const hub = createInMemoryChannelHub()
2. const { channel, voiceAdapter } = createStack({ mode: 'local', hub, selfId: SELF_ID,
     onRoomJoined: () => { audio.play() },
     onRoomLeft:  () => { audio.pause(); audio.currentTime = 0 } })
3. const store = createStore({ selfId: SELF_ID, officeId: 'debug-office' })
4. const bus = createBus()
5. const actions = createActions(store, bus)
6. actions.upsertPlayer({ id: SELF_ID, name: 'You', pos: { x:0, y:0, z:0 }, vel:{x:0,y:0,z:0}, yaw:0 })
7. const rules = createRuleRegistry(); rules.addRule(proximityRule)
8. attachProximityReducer(store, bus)
9. const sync = new SyncEngine({ store, actions, bus, channel, clock: { now: () => performance.now() } })
10. const handshake = new SnapshotHandshake({ selfId: SELF_ID, store, actions, sync, channel,
      clock: { now: () => performance.now() },
      serialize: () => serializeOfficeState(store.getState()) })
11. const comm = new Communication({ selfId: SELF_ID, store, actions, bus, voice: voiceAdapter })
12. const botDriver = new BotDriver({ hub, localPlayerPosGetter: () => store.getState().players[SELF_ID]?.pos ?? {x:0,y:0,z:0} })
13. await channel.subscribe(); channel.trackPresence({})
14. sync.start(); handshake.start(); comm.start()
15. await botDriver.start()
16. const renderer = new WorldRenderer(containerRef.current)
17. Start RAF loop
```

### RAF loop
```ts
let lastTime = performance.now();
let prevState = store.getState();
let rafId: number;

function loop(now: number) {
  const dt = now - lastTime; lastTime = now;
  actions.tick(now);
  const current = store.getState();
  rules.tick(current, prevState, bus);
  prevState = store.getState(); // capture post-reducer state
  sync.flushPosition();
  handshake.tickTimers();
  botDriver.tick(dt);
  renderer.render(store.getState());
  rafId = requestAnimationFrame(loop);
}
rafId = requestAnimationFrame(loop);
```

### Cleanup (useEffect return)
```ts
return () => {
  cancelAnimationFrame(rafId);
  comm.stop(); sync.stop(); handshake.stop(); botDriver.stop();
  channel.close(); renderer.dispose();
};
```

### Render output
```tsx
<div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
  <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
  <BotControlPanel botDriver={botDriver} />
</div>
```
`BotControlPanel` is built in Task 08. For now, import a placeholder `() => null` if Task 08 is not complete.

### Audio element
Create an `HTMLAudioElement` in the effect:
```ts
const audio = new Audio('/elevator-music.mp3');
audio.loop = true;
audio.volume = 0.4;
```
Pass `onRoomJoined` / `onRoomLeft` callbacks to `createStack` that call `audio.play()` / `audio.pause()`.

### WASD movement (minimal)
Add a `keydown` listener that updates `selfPos` via `actions.setSelfPosition` when WASD or arrow keys are pressed. Move speed: 3 m/s × `dt/1000`. This gives the developer a way to move the local player to test proximity.

## Acceptance Criteria
- [ ] Running `pnpm --filter @officexr/debug-app dev` and opening `http://localhost:5174` shows a Three.js canvas with a blue box (local player) and a grey box (bot) rendered at their initial positions.
- [ ] Pressing W/A/S/D moves the local player box in the scene.
- [ ] When the bot walks into proximity (via BotControlPanel in Task 08), the blue box and grey box are rendered within `BUBBLE_RADIUS` of each other.
- [ ] No console errors on load (other than expected `Audio.play()` autoplay policy deferral).
- [ ] No imports from `@officexr/core` or `packages/core/`.
- [ ] `pnpm --filter @officexr/debug-app typecheck` passes.

## Dependencies
- Depends on: Task 01, Task 02, Task 04, Task 05, Task 07
- Blocks: Task 08, Task 09
