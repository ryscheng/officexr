# 05. Migration Plan

How we get from today's `RoomScene` god component to the architecture
described in docs 00–04, without breaking voice, chat, or the
3D world along the way.

> Each step is shippable on its own. Each step has an exit criterion
> that's observable, not subjective. Steps are tied to the
> ARCHITECTURE.md observations they resolve.

## Sequencing rationale

The order is constrained by three things:

1. **Voice and chat must keep working at every step.** This rules
   out big-bang rewrites. Each step is an in-place transform.
2. **GameState is the foundation.** Until the store exists, nothing
   else can decouple from `RoomScene`. So the first real refactor
   step builds the store skeleton.
3. **Hottest debt first, where cheap.** The zombie subsystem is the
   most state-heavy and the most self-contained, so it's a great
   first migration target — same recommendation ARCHITECTURE.md
   already makes.

## Studio split addendum

Steps 1, 2, 5, and 6 landed (in shape if not in scope) via the
`@officexr/studio` split before the production-`web` migration began:

- **Step 1** (carve `@officexr/sdk`): `packages/sdk/` exists with
  game-state + realtime + spatial + data modules.
- **Step 2** (define `OfficeState` types and store skeleton): done;
  `OfficeState` includes `worldSettings`, `worldMap`, and
  `characterConfigs` (added by the studio split).
- **Step 5** (extract `communication/` subtree): communication lives
  in `@officexr/core-refactor` (NOT `@officexr/app` as named in the
  earlier draft). Headless, no `three`, no `react`.
- **Step 6** (define `NetEvent` protocol): typed PROTOCOL table exists
  in `packages/sdk/src/realtime/protocol.ts`. `world:characters` was
  added by the studio split as the third broadcast-on-change slot
  alongside `world:settings` and `world:map`.

`packages/web/` and `packages/core/` were intentionally **not touched**
by the studio split. The remaining migration steps (4 — pull THREE out
of `usePresence`; 9 — shrink `RoomScene`; 10 — mobile parity) all
operate on the `core/` codepath and remain TODO.

## The eleven steps

```mermaid
flowchart LR
    S1["1. Carve<br/>@officexr/sdk"] --> S2["2. Define<br/>OfficeState types"]
    S2 --> S3["3. Migrate<br/>zombies to store"]
    S3 --> S4["4. Pull THREE<br/>out of usePresence"]
    S4 --> S5["5. Extract<br/>communication/"]
    S5 --> S6["6. Define<br/>NetEvent protocol"]
    S6 --> S7["7. Build sync.ts<br/>+ snapshot handshake"]
    S7 --> S8["8. inventory →<br/>Postgres"]
    S8 --> S9["9. Shrink<br/>RoomScene → RoomPage"]
    S9 --> S10["10. Mobile<br/>parity on sdk"]
    S10 --> S11["11. Tests<br/>(convergence + rules)"]

    classDef step fill:#312e81,stroke:#a78bfa,color:#ede9fe
    class S1,S2,S3,S4,S5,S6,S7,S8,S9,S10,S11 step
```

## Step 1 — Carve `@officexr/sdk`

> Resolves prerequisite for **O9**.

Create `packages/sdk/` as a new pnpm workspace package. No logic
moves yet — this step lays the empty rooms.

- New folders:
  - `sdk/src/data/supabase.ts` — moved from `core/lib/supabase.ts`.
  - `sdk/src/data/types.ts` — moved Database types.
  - `sdk/src/auth/useAuth.ts` — moved from `core/hooks/useAuth.ts`
    (still React for now; will split if needed). *Note:* if React
    in `sdk` is unacceptable, move only the headless `getSession()`
    helpers and keep the hook in `app`.
- `core` re-exports from `sdk` so existing import paths keep working.
- `mobile/src/lib/supabase.ts` is replaced by an import from `sdk`.
- `mobile/src/hooks/useAuth.ts` is replaced by an import from `sdk`.

**Exit criteria:**
- `pnpm build` passes for all packages.
- `mobile` boots and authenticates against the same supabase
  client instance (one source of truth).
- A grep finds zero remaining copies of the supabase URL/anon-key
  outside `sdk`.

## Step 2 — Define `OfficeState` types and store skeleton

> Resolves prerequisite for **O1**, **O3**.

- `sdk/src/game-state/types.ts` — the shape from
  [02-game-state](./02-game-state.md). Plain TS, no THREE.
- `sdk/src/game-state/store.ts` — Zustand-backed store with
  `getState`, `setState`, `subscribe`, `subscribeAll`, plus a
  per-tick `tick()` that runs registered rules.
- `sdk/src/game-state/bus.ts` — typed event emitter.
- `sdk/src/game-state/rules.ts` — `addRule(rule)`, deterministic
  invocation order.
- One trivial smoke test: create a store, mutate, assert
  subscribers fired.

No call site uses the new store yet.

**Exit criteria:**
- Types compile.
- A stub `createStore()` returns an empty `OfficeState`.
- `addRule` + `tick` works in unit tests.

## Step 3 — Migrate the zombie subsystem to the store

> Resolves **O1** for one feature, exercises store API.

Move `useZombieGame`'s 27+ refs into `OfficeState.zombies`:

- `phaseRef`, `waveRef`, `totalKillsRef` → `state.zombies.{phase, wave, totalKills}`.
- `playerHealthsRef` → `state.zombies.playerHealths`.
- `zombieEntitiesRef` → `state.zombies.entities`.
- `hostIdRef` → `state.zombies.hostId`.
- Delete every `setPhaseSync`, `setWaveSync`, etc. HUD reads via
  Zustand selectors.
- The zombie host AI step becomes a function that takes
  `(state, dt)` and returns a list of mutations to apply. The
  per-frame `RoomScene` callback that runs zombie AI shrinks to
  one call.
- The zombie subsystem still uses today's broadcast strings; the
  protocol overhaul is step 6.

**Exit criteria:**
- `phaseRef` and similar ref-mirror pairs do not exist anywhere.
- `ZombieHUD` re-renders only when its selected slice changes
  (verified with React Profiler).
- A zombie wave plays end-to-end against the new store.

## Step 4 — Pull THREE out of `usePresence`

> Resolves **O4** for the most THREE-tangled hook.

`usePresence` (763 lines) currently calls `scene.add(sphere)`,
constructs `MeshStandardMaterial`, reads `cameraRef.current.position`.

Refactor:

- Position computation, proximity computation, jitsi-room derivation
  → pure functions that read/write `OfficeState`.
- Bubble-sphere creation, avatar group lerp, scene additions →
  move into `@officexr/world/renderer/` reconcilers.
- Add `proximityRule` per [02-game-state](./02-game-state.md) §
  *Worked example: proximity*.
- The remaining `usePresence` shell becomes a thin selector wrapper
  or is deleted entirely.

Other hooks that import THREE (`useShooting`, `useWhiteboard`,
`useSceneSetup`, `useScreenSharing`, `useNetworkStats`,
`useChannelLogger`, `useZombieGame`, `useMotionControls`,
`useKeyboardControls`) get the same treatment in this step. By the
end, only files in `@officexr/world/renderer/` import from `three`.

**Exit criteria:**
- `git grep "from 'three'"` returns matches only inside
  `packages/world/src/renderer/**`.
- ESLint rule `no-restricted-imports` for `three` outside
  `renderer/**` is in CI.
- Voice still works during proximity transitions (manual smoke).

## Step 5 — Extract `communication/` subtree

> Resolves **O5** partially. Locks the isolation invariant.

- New folder `packages/core-refactor/src/communication/`.
- Move `useJitsi` body into a `<Communication>` component +
  internal hooks. The Jitsi iframe, JWT generation, mic monitor,
  screen-share signaling, and audio decay timers all move here.
- `Communication` reads `proximity:entering|exiting` from the bus
  and writes `setMyJitsiRoom(...)` to the store. It does not query
  `state.players[*].pos`.
- Mount `<Communication>` as a sibling of `<WorldRenderer>` inside
  `RoomScene` (still a god component, but now with three siblings
  instead of one giant blob).
- Wrap each sibling in its own `<ErrorBoundary>`.
- `lib/jaasJwt.ts` moves to `@officexr/core-refactor`'s communication
  subsystem (`packages/core-refactor/src/communication/jaasJwt.ts`).

**Exit criteria:**
- Manual test: throw a synthetic error inside `WorldRenderer`
  (e.g., toggle a debug switch). The Jitsi call audio continues
  uninterrupted; HUD and Communication remain mounted.
- Grep for `import.*three` under `communication/**` returns zero.
- Grep for `useJitsi` outside `communication/**` returns zero.

## Step 6 — Define the `NetEvent` protocol

> Resolves **O6**.

- `sdk/src/realtime/protocol.ts` — full tagged union from
  [03-realtime-layer](./03-realtime-layer.md).
- Zod schemas per kind. CI lints that every kind in the union has
  both a schema and an authority annotation.
- New `RealtimeChannel` adapter (`channel.ts`) replaces
  `useRealtimeChannel`. Single subscribe; `send(event: NetEvent)`.
- Migrate every existing `channel.send({ type: 'broadcast', event:
  '<string>' })` and `channel.on('broadcast', { event: '...' }, ...)`
  call to use the typed adapter.
- Per-actor `seq` counters are added; receivers dedupe.
- Schema-mismatch HUD banner lands here.

This step is large but mechanical. It can be split per feature if
needed (one PR per event family), as long as old + new transports
do not coexist for the same kind.

**Exit criteria:**
- `git grep "type: 'broadcast'"` returns zero matches outside
  `sdk/realtime/`.
- Sending an unknown-version event surfaces the version-warning
  banner exactly once per session per kind.

## Step 7 — Build `sync.ts` and the snapshot handshake

> Resolves **O7** (documents authority), prepares for **O11**.

- `sdk/src/realtime/sync.ts` — store-mediated translator from
  [03-realtime-layer](./03-realtime-layer.md).
- Outbound: subscribe to store mutations, emit `NetEvent`s; for
  `presence:position`, implement delta-triggered + velocity-vector
  + stop-packet logic with the constants table.
- Inbound: validate, dedupe, apply to store.
- Snapshot-on-join handshake (`snapshot:request` /
  `snapshot:offer`). New clients queue events until snapshot is
  applied.
- Authority annotations are read off the protocol but **not
  enforced**. Per-event lint warnings on host mismatch are emitted
  to the bus for visibility.

**Exit criteria:**
- A stationary user broadcasts 0 `presence:position` packets per
  minute.
- A walking-then-stopping user emits exactly one final `vel = 0`
  packet within `STOP_GRACE_MS`.
- Two clients in the same office, one of which reloads mid-game,
  converge on identical `OfficeState` slices for `players`,
  `chat`, `whiteboard`, and `zombies` after the snapshot handshake.

## Step 8 — Move `inventory` and `lootbox_state` to Postgres

> Resolves **O8**.

- New migrations: `015_inventory.sql`, `016_lootbox_state.sql`
  with the schema from
  [04-persistent-data-layer](./04-persistent-data-layer.md).
- New `sdk/src/data/inventory.ts` and `lootboxState.ts`.
- HUD and game-state hydration pull from Postgres; the persistence
  bus subscriber writes through on `inventory:*` events.
- Transition reads: if Postgres returns empty for a user who has a
  `localStorage` inventory, upsert the local data into Postgres
  and clear the key. After one release, drop the fallback.

**Exit criteria:**
- After fresh-profile login, inventory matches the user's other
  device.
- `localStorage.getItem('officexr_inventory')` returns null for
  any user who has logged in since this release.
- `localStorage.getItem('officexr_lootbox_cooldown')` returns null
  similarly.

## Step 9 — Shrink `RoomScene` to `RoomPage`

> Resolves **O5** completely.

- Rename `RoomScene.tsx` → `RoomPage.tsx`. The remaining body is
  the composition root from [01-application-layer](./01-application-layer.md):
  `<GameStateProvider>`, three error-boundary-wrapped siblings,
  `<SyncEngine>`. Roughly 150 lines.
- Delete every `useState`/`useRef` for game state at this layer
  (none should remain after steps 3–7).
- Delete every cross-hook ref-thread (`presenceDataRef` into
  `useZombieGame`, `pauseProximityDetectionRef` back into
  `usePresence`, etc.). All cross-subsystem coupling now flows
  through the bus.

**Exit criteria:**
- `RoomPage.tsx` is under 200 lines.
- `git diff` for this PR is dominated by deletions.
- The room boots, voice connects, the world renders, the HUD
  responds — same behavior as before.

## Step 10 — Mobile parity on `@officexr/sdk`

> Resolves **O9** completely.

- Delete `mobile/src/lib/supabase.ts`,
  `mobile/src/hooks/useAuth.ts`, and any other duplicates that
  step 1 left behind.
- Mobile imports from `sdk` only.
- Mobile is now positioned to subscribe to `OfficeState` and
  `bus` if/when a mobile UI is built. Renderer remains web-only.

**Exit criteria:**
- `mobile` builds and authenticates.
- Auth fixes applied to `sdk` propagate to mobile without code
  changes there.

## Step 11 — Tests

> Resolves **O11**.

Three test layers, all unblocked by earlier steps:

- **Rule unit tests.** Pure `(state, prev) → emissions` assertions.
  Cheap because rules are pure.
- **Reducer tests.** Dispatch a store action, assert the resulting
  state.
- **Two-client convergence test.** Spin up two stores in one
  process, pipe their outbound `NetEvent`s into each other's
  inbound queues, replay a scripted input sequence, assert
  agreement on `players`, `chat`, `whiteboard`, `proximity` after
  N ticks. Test scenarios include:
  - Both clients start empty; one walks, the other receives.
  - One client joins late (snapshot handshake exercised).
  - One client reloads mid-game (reconnect path exercised).
  - A schema-mismatch event is injected (HUD banner asserted).
  - Host disconnect (zombie host handover asserted).

**Exit criteria:**
- Each scenario passes deterministically in CI.
- Adding a new `NetEvent` kind requires adding a convergence
  scenario or explicitly opting out (CI lint).

## What is **not** in the migration plan

- **Fixed-timestep simulation** (full O2 fix) — the layered loop
  inside `WorldRenderer` (input → tick → render) is enough for
  this refactor's goals. A formal Gaffer-on-Games timestep is a
  follow-up.
- **Server-authoritative economy events** — explicitly out of
  scope per the peer-trusted decision. The architecture leaves
  the door open (Edge Function adapter slots cleanly into the
  `loot:open` and `shot:hit` paths) but does not deliver it.
- **SFU for screen sharing** (O10 ceiling) — out of scope; the
  realtime layer is shaped to make the swap a localized change.
- **Custom maps / `room_maps` table** — out of scope; the data
  layer is shaped to accept it later.

## Risk and rollback

- **Each step is independently revertable** at the PR level.
- The risky steps for voice are 5 (extracting `communication/`)
  and 7 (snapshot handshake). Both have manual smoke acceptance
  criteria specifically for voice continuity.
- The risky step for game balance is 8 (inventory move). The
  `localStorage` fallback during transition makes a regression
  recoverable.
- The riskiest step technically is 6 (protocol overhaul). It can
  be split per feature if needed; a single big-bang PR is
  acceptable only if the convergence test from step 11 lands
  alongside it.

## Total scope

This refactor is roughly:

- ~3,000 lines deleted (the `RoomScene`/hook tangle).
- ~2,000 lines added (sdk modules, store, sync, protocol).
- ~500 lines moved (jaasJwt, supabase client, types).
- 2 new migrations.
- 1 new pnpm package.
- 1 new ESLint rule for THREE imports.

Net effect: a smaller, more typed, more testable codebase whose
voice/chat product survives renderer crashes and version skew.
