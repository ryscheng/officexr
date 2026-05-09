# Code Review (round 2)

## Compliance score: 9 / 10  (delta from previous: +2)

## Summary
Both Critical findings and the bulk of the Important findings from the
previous pass are genuinely resolved, not papered-over. The seqTable bug
is fixed by extracting an `InboundSeqTable` collaborator that both
SyncEngine and SnapshotHandshake share, and the regression test was
strengthened from a single-message tautology into a real three-message
dedup case plus a positive "live-after-snapshot" case. The trust-boundary
hole at `ZSerializedOfficeState` is closed with a real composed schema.
Tests pass: 78 / 85 in sdk (7 Supabase live tests auto-skip), 15 / 15 in
core-refactor; typecheck is clean. The fix introduced one real new
problem worth noting (zustand swap silently dropped the hand-rolled
store's listener-error isolation) and a couple of small concerns around
the new `pauseInbound`/`resumeInbound` flow.

## Resolution of previous findings

### Critical 1 — snapshot seqTable: **RESOLVED**
- New shared collaborator `packages/sdk/src/realtime/inbound-seq-table.ts:1-43`
  cleanly owns the per-actor monotonic seq map. SyncEngine accepts it as
  a constructor option and exposes `getInboundSeqTable()` and
  `lastOutboundSeq()` (`sync.ts:89-100`). SnapshotHandshake reads both
  to assemble the offer's `seqTable` as `{ ...inboundSnapshot, [self]: lastOutbound }`
  (`snapshot-handshake.ts:158-168`).
- The regression test (`snapshot-handshake.test.ts:110-158`) now seeds
  three pre-snapshot chats (`pre-1`, `pre-2`, `pre-3` with `seq=1,2,3`),
  replays all three "live" during the snapshot window, and asserts each
  text appears exactly once. This is a real test: under the old
  `nextSnapshotSeq - 1` code, the leader's `seqTable[alice]` would have
  been 1 (one snapshot:offer envelope sent), the dedup would have
  missed seq=2 and seq=3, and `counts.get('pre-2')` would be 2. The
  positive case ("applies live events with seq beyond the snapshot
  seqTable", `snapshot-handshake.test.ts:160-188`) covers the inverse.

### Critical 2 — `ZSerializedOfficeState = z.any()`: **RESOLVED**
- `protocol.ts:109-121` defines `ZSerializedOfficeState` as a real
  composed `z.object` over `selfId`, `officeId`, `players`, `proximity`,
  `chat`, `whiteboard`, `zombies`, `inventory`, `screenShares`,
  `realtime`, `runtime`. Each field references a previously-built
  primitive (`ZPlayerState`, `ZZombieState`, `ZWhiteboardState`,
  `ZRealtimeState`, etc.). The schema is structural-strict (no
  `.passthrough()`), so `players: 'oops'` or
  `players: { me: { hp: 9999 } }` are now both rejected at
  `validateNetEvent` time before `applySnapshot` ever sees them.
- The protocol round-trip test (`protocol.test.ts:62-92`) ships a full
  shape through `validateNetEvent` and asserts it parses, which exercises
  the new schema. ✅

### Important — two-client harness `tick(prev=current)`: **RESOLVED**
- `two-client.ts:67-69` introduces a `lastTickState` map keyed by client
  id. `tick()` now passes the previous tick's snapshot as `prev`
  (`two-client.ts:124-137`) and re-captures `store.getState()` AFTER the
  rules run, so reducer-driven mutations from the current tick are
  visible as `prev` on the next tick. The audio-video routing
  integration test was simplified to use `h.tick()` directly
  (`audio-video-routing.test.ts:38, 54-66, 79`), removing the local
  ad-hoc `tickRules` helper that re-implemented the same prev=current
  bug at the call site.
- Note: the order is `actions.tick(now)` first (writes `runtime.lastTick`),
  then `current = store.getState()`, then `rules.tick(current, prev, bus)`.
  This means `current.runtime.lastTick !== prev.runtime.lastTick` on
  every tick, which matches doc 02's "tick is a phase boundary" intent.

### Important — `applyInbound` / `seedSeqTable` escape hatches: **RESOLVED**
- Both methods are gone from `SyncEngine`. Replaced with
  `pauseInbound()` / `resumeInbound()` (`sync.ts:107-117`) that buffer
  inbound events on a private `pausedQueue` and drain them through the
  normal `dispatchInbound` path on resume. The shared seq-table is
  exposed via `getInboundSeqTable()` for `SnapshotHandshake.seed(...)`,
  not via a poke-the-engine method. The trust relationship is now
  one-way (handshake reads/seeds the table; engine owns the dispatch).

### Important — authority lint for `zombie:state`: **RESOLVED, with caveat**
- `sync.ts:323-332` implements `maybeAuthorityWarn` and runs it on
  every dispatched non-snapshot event. For `zombie:state` (the only
  `authority: 'host'` kind in PROTOCOL), it logs a warning when
  `event.actorId !== state.zombies.hostId` and `hostId` is non-null.
- Caveat: the previous review's exact ask was "non-host means not the
  current lex-min living player." The implementation uses
  `state.zombies.hostId` from the local store, which should equal the
  lex-min once host election runs, but isn't structurally guaranteed
  to. Acceptable per refactor-plan/03 ("the host is whoever owns
  `hostId`"); flag if the spec is later tightened. No test asserts the
  warning is logged — `maybeAuthorityWarn` is currently uncovered.

### Important — `addInventoryItem` / `removeInventoryItem` / `applyHit` bus emissions: **RESOLVED**
- `actions.ts:120-138` now emits `combat:hit`, `combat:killed`,
  `inventory:added`, `inventory:removed` through an optional `Bus`
  passed to `createActions(store, bus)`. The harness and integration
  helpers were updated to thread the bus through
  (`two-client.ts:74-75`, `_helpers.ts:84-89`). `removeInventoryItem`
  no longer accepts the dual `id || itemId` predicate; it matches by
  `id` only, consistent with `MemoryPersistenceAdapter`.
- Test coverage: `sync-inbound.test.ts:154-171` now asserts that
  `shot:hit` routes through `applyHit` and emits exactly one `combat:hit`
  on the bus. ✅
- Minor concern (new): in `actions.ts:120`, `bus?.emit('combat:hit')`
  fires unconditionally even when the target doesn't exist (the
  `setState` no-ops via `if (!target) return {};` but the bus emit
  is outside the setState callback). A `shot:hit` against a
  non-existent target now emits a phantom `combat:hit`. Same applies
  if `dmg=0` (no real damage). Edge case; flag as Minor.

### Important — `applyToStore` no-ops on 9 NetEvent kinds: **RESOLVED**
- `whiteboard:clear`, `whiteboard:undo`, `screen:*`, `bubble:prefs`,
  `net:ping`, `net:pong`, `loot:open` were dropped from the protocol
  union (`protocol.ts:148-160`). The switch in `applyToStore` is now
  exhaustive (compile-time assertion at line 376) over the 8 kinds that
  remain. A `grep` for the dropped kinds across `packages/sdk/src` and
  `packages/core-refactor/src` returns only the explanatory comment at
  `protocol.ts:141-144`. No leftover dispatch, no leftover tests.
- Trade-off acknowledged: a peer running an older protocol that still
  ships `whiteboard:clear` will be rejected by `validateNetEvent` with
  reason `unknown-kind`. That's a clean failure mode and is documented
  in the comment.

### Important — CI `supabase start` cold-runner image pull: NOT addressed
- `.github/workflows/ci.yml` was not modified by either fix commit.
  The original Important about cold-runner image pull stands as a
  CI ergonomics concern but isn't strictly blocking. Carry forward.

### Important — `BROADCAST_EVENT = 'office-net-event'` magic string: NOT addressed
- `supabase-channel.ts:9` unchanged. Carry forward as Minor.

### Minor — `zustand` declared but unused: **RESOLVED**
- The store now uses `zustand/vanilla` + `subscribeWithSelector`
  middleware (`store.ts:1-2, 55-58`). Hand-rolled implementation gone.
  See "New findings" below for one regression introduced by this swap.

### Minor — `runtime.lastTick` dead: **RESOLVED**
- New `tick(now)` action (`actions.ts:198-202`) writes
  `runtime.lastTick`. Harness drives it on every `tick()`
  (`two-client.ts:125-127`).

### Minor — `removeInventoryItem` dual-key predicate: **RESOLVED**
- Now matches by `id` only (`actions.ts:131-138`), consistent with
  `MemoryPersistenceAdapter.removeInventoryItem`.

### Minor — `applyHit` `void byId`: **RESOLVED**
- `byId` is threaded into `combat:hit` and `combat:killed` bus
  emissions (`actions.ts:120-121`).

### Minor — concurrent `requestSnapshot()` resolver chain: **RESOLVED**
- `snapshot-handshake.ts:89-106` now uses `pending.resolvers: Array<() => void>`
  and `finish()` (`snapshot-handshake.ts:202-211`) iterates the array.
  Three concurrent callers all resolve correctly.

### Minor — `whiteboard:stroke` re-broadcast tautology test: PARTIALLY addressed
- The test (`sync-inbound.test.ts:173-203`) was renamed in title but
  the assertion is unchanged — it still passes even if the no-echo
  guard at `sync.ts:166-183` were removed, because the SyncEngine only
  broadcasts strokes whose `authorId === selfId`. The remote stroke's
  authorId is `'other'`, so it would not be broadcast regardless of any
  echo guard. Flag still valid; carry as Minor.

### Other carry-forward Minors (not targeted by these fixes)
- Hardcoded `SUPABASE_ANON_KEY` fallback in
  `_helpers.ts:18` — still the demo key. Doesn't fail-fast if
  `SUPABASE_URL` is set without a key.
- `tools/supabase-test/supabase/migrations/` empty directory — not
  addressed.
- `seqTable: z.record(z.string(), z.number())` doesn't enforce
  per-actor-monotonic invariant — still just a record-of-numbers
  schema. Comment at `inbound-seq-table.ts:27-37` documents the
  invariant; the schema does not.
- `WithEnvelope<K, V, P = {}>` still uses `{}` default
  (`protocol.ts:146`).

## New findings (introduced by the fixes)

### Critical
None.

### Important

- **packages/sdk/src/game-state/store.ts:55-74** — the zustand swap
  silently dropped the previous store's per-listener `try/catch`
  isolation. The hand-rolled implementation wrapped every listener
  invocation in `try { ... } catch (err) { console.error(...) }`
  (commit history shows this as a load-bearing detail; the previous
  review explicitly called it out as "the kind of detail that bites
  hard if missed"). zustand/vanilla's `setState`
  (`node_modules/.pnpm/zustand@5.0.13/.../vanilla.js:11`) calls
  `listeners.forEach((listener) => listener(state, previousState))`
  with no try/catch — a throwing listener aborts the iteration and
  later listeners do not fire for that update. There is no test for
  this property in `store.test.ts`. In production, a single broken
  rule subscriber would now silently break unrelated subscribers
  (HUD, sync engine, persistence write-through, etc.) for every
  setState that happens to register listeners after it. The existing
  `bus.ts` has its own try/catch isolation, so the bus is safe; the
  store is not. Either restore the try/catch in the Store facade
  (wrap each subscriber with a try/catch in the `subscribe` /
  `subscribeAll` adapters) or accept the contract change and document
  it loudly.

### Minor

- **packages/sdk/src/game-state/actions.ts:120-122** — `applyHit`
  emits `combat:hit` on the bus *unconditionally* even when the
  target player doesn't exist (the `setState` updater short-circuits
  via `if (!target) return {};` but the `bus?.emit` lives outside
  the setState callback). A `shot:hit` against a non-existent
  `targetId` now produces a phantom `combat:hit` event. Same applies
  if `dmg=0` (no real state change but bus still emits). Move the
  emit into a path that observes the actual state delta (e.g., set
  a `hit = false` flag inside the updater and emit only if true).

- **packages/sdk/src/realtime/sync.ts:323-332** — `maybeAuthorityWarn`
  is uncovered by tests. Adding one test that drives a `zombie:state`
  from a non-host actor and asserts a `console.warn` would close the
  gap and prevent silent regression.

- **packages/sdk/src/realtime/snapshot-handshake.ts:182-200** — if
  `applySnapshot()` throws inside `setState` (e.g., a
  surface-level Zod-passing snapshot still exposes a runtime invariant
  bug in `applySnapshot`), `finish()` is not called, the engine
  remains paused, and the queue grows unbounded. Wrap the apply +
  seed in a try/finally that always calls `finish()`. Edge case but
  cheap to defend.

- **packages/sdk/src/game-state/store.ts:65-69** — the `Store.subscribe`
  adapter passes `equals ? { equalityFn: equals } : undefined` to
  zustand. zustand's default behavior when no `equalityFn` is given is
  `Object.is`. If a caller relies on `Object.is` for object-typed
  selectors (which would make the listener fire on every setState
  since each setState produces a new object), the behavior matches the
  old store's `equals = Object.is` default and is fine — but worth a
  docstring note that "shallow equality requires explicit `equals`."

- **packages/sdk/src/realtime/sync.ts:301-304** — when `paused` is true,
  events are pushed onto `pausedQueue` BEFORE the version-mismatch
  check runs (the v-mismatch check happens earlier in `onInbound`). On
  drain, `dispatchInbound` does NOT re-run the v-mismatch check.
  Currently fine because version mismatch already returned early at
  the top of `onInbound` before the pause check, so v-mismatched
  events never enter the queue. Worth a one-line comment confirming
  this ordering invariant.

- **packages/sdk/src/realtime/sync.ts:313** — `maybeAuthorityWarn` is
  called AFTER `markSeen`. If a non-host `zombie:state` arrives twice,
  only the first triggers the warning (the second is deduped). Likely
  desired (don't spam) but not commented.

## Strengths

- The new `InboundSeqTable` is exactly the right shape: a small,
  single-responsibility collaborator with three methods (`isDuplicate`,
  `markSeen`, `seed`, plus `snapshot()` for shipping). Both modules
  read/write the same instance; no public accessors leak the
  underlying Map.
- The `pauseInbound`/`resumeInbound` model is much cleaner than the
  previous `applyInbound`/`seedSeqTable` poke methods. Inbound flow
  always passes through `dispatchInbound`, dedup is consistent across
  live and replayed events, and the pause flag has a single owner
  (SnapshotHandshake).
- The exhaustiveness check at `sync.ts:376` (`const _exhaustive: never = event`)
  is the right CI lint to add a new NetEvent kind without a case
  becomes a compile-time error, not a silent runtime no-op.
- Dropping the 9 unwired NetEvent kinds was the right call: a partial
  implementation behind a switch is worse than a missing one. The
  comment at `protocol.ts:140-144` explains the intent and points at
  the migration plan.
- The strengthened snapshot regression test
  (`snapshot-handshake.test.ts:110-188`) is now genuinely load-bearing.
  Three pre-snapshot messages with seq=1,2,3 explicitly defeat the old
  "seq=1 collides with offer's own seq=1" tautology, and the positive
  "live-after-snapshot" case asserts the symmetric correctness path.
- Composing `ZSerializedOfficeState` from existing primitives
  (`ZPlayerState`, `ZZombieState`, etc.) keeps the schema in lockstep
  with the runtime types — no parallel "snapshot schema" to drift.
- Three concurrent `requestSnapshot()` callers now correctly all
  resolve via the resolver array. The previous Minor bug ("third
  caller's resolver only fires the second's") is gone.
