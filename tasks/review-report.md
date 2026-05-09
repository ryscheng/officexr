# Code Review

## Compliance score: 7 / 10

## Summary
The skeleton of the SDK and Communication subsystem is in place and matches the
target shape: plain-TS GameState store, typed `NetEvent` protocol, abstract
`Channel` with in-memory and Supabase implementations, headless Communication
that consumes proximity events. Tests pass (77 passed / 7 skipped in sdk; 15/15
in core-refactor; integration suites auto-skip without Supabase). The branch
falls short on two correctness points in the snapshot handshake and on a few
LSP/contract issues between the in-memory and Supabase channel adapters; the
schema for inbound snapshot state is also `z.any()`, which is a real
trust-boundary leak.

## Architectural compliance

- **Isolation invariant (00-overview.md §"isolation invariant")** holds:
  `grep -rn "from 'three'" packages/sdk/src packages/core-refactor/src` returns
  zero matches, and `core-refactor` imports nothing from a renderer/. ✅
- **Module boundaries (00-overview.md §"Package boundaries")** mostly hold:
  SDK has no React, no THREE; core-refactor depends on `@officexr/sdk` only.
  ✅ One stray smell: `packages/sdk/package.json:21` declares `"zustand":
  "^5.0.2"` but `packages/sdk/src/game-state/store.ts` is hand-rolled and never
  imports zustand — declared dependency is unused.
- **Store / bus / rules separation (02-game-state.md §"Three pieces")**: rules
  are observers (`rules.ts`, `rules/proximity.ts`); reducers (`reducers/proximity.ts`)
  do mutations; bus is synchronous (`bus.ts:14-25` iterates a `slice()`d
  list and dispatches inline). Matches the spec. ✅
- **OfficeState shape (02-game-state.md §"OfficeState shape")** matches the
  doc 1:1, including `tRecv`, `realtime.versionWarnings`, and `runtime`. ✅
- **`runtime.lastTick` is dead** — `packages/sdk/src/game-state/store.ts:36`
  initializes it to 0 and nothing ever writes to it. The spec
  (01-application-layer.md §"Frame loop") specifies a tick phase that advances
  `runtime.lastTick`. Either remove the field or wire a tick action.
- **NetEvent tagged union (03-realtime-layer.md §"NetEvent protocol")**:
  the spec lists `zombie:spawn`, `zombie:kill`, `zombie:wave-start`,
  `zombie:end`, `zombie:player-dead` as distinct kinds. The implementation
  collapses all of these into a single `zombie:state` snapshot
  (`protocol.ts:102`). May be defensible (one host snapshot replaces all
  granular events) but it's an undocumented divergence from the spec.
- **Single channel + ack:on broadcast (03-realtime-layer.md §"single channel")**:
  `supabase-channel.ts:56-62` sets `broadcast: { ack: true, self: false }`
  and `presence: { key: this.userId }`. ✅ Single broadcast event name
  (`'office-net-event'`) for all kinds, sync engine demuxes via the envelope's
  `kind` field. ✅
- **Snapshot-on-join (03-realtime-layer.md §"Snapshot-on-join"):** leader
  election is correct (`snapshot-handshake.ts:13-19`, lex-min excluding
  requester). Queueing window is correct. The drained-events dedup is
  **broken** — see Critical issues; the `seqTable` baked into `snapshot:offer`
  is sourced from the handshake's own `nextSnapshotSeq` counter, which is
  unrelated to the SyncEngine's outbound `nextSeq`. Live duplicates of events
  already in the snapshot are not deduped in the general case.
- **Position throttling (03-realtime-layer.md §"presence:position")**:
  delta-trigger, MAX_HZ ceiling, and stop-grace packet implemented and
  unit-tested (`sync.ts:156-229`, `sync-outbound.test.ts:97-127`). ✅ One
  caveat: the spec sets the stop test as `dt > STOP_GRACE_MS` measured from
  the *last send*; the implementation measures from `pendingStopCheckSinceMs`
  set on first quiet observation. The implementation is arguably more correct
  but is a quiet semantic difference from the doc.
- **Version-mismatch handling (03-realtime-layer.md §"Schema mismatch
  handling")**: drop + once-per-kind warning works (`sync.ts:251-260`).
  Coverage is duplicated between `SyncEngine.versionWarnedKinds` (in-memory)
  and `state.realtime.versionWarnings` (in-store), which is mildly redundant
  but harmless.
- **Authority annotations (03-realtime-layer.md §"Authority")**: present in
  `PROTOCOL` table. **Not enforced**, **not validated, not warned on
  mismatch** — the doc explicitly asks for "a per-event authority lint:
  when a `zombie:state` event arrives whose `actorId` is not the current
  lex-min living player, log a warning". Not implemented.
- **Persistent data layer (04-persistent-data-layer.md):** only the
  `PersistenceAdapter` interface and an in-memory adapter are provided. No
  inventory bus emissions wire the actions to a write-through subscriber
  (the doc specifies `bus.on('inventory:added', …)`). Acceptable for this
  step (the migration plan explicitly defers Postgres inventory to step 8),
  but the actions in `actions.ts:111-119` should at minimum emit the
  `inventory:added`/`inventory:removed` GameEvents already defined in
  `types.ts:124-125`, otherwise the bus contract is a fiction. Currently
  the bus events `inventory:added` and `inventory:removed` are declared
  but never emitted from the SDK.

## SOLID / CLEAN findings

- **DIP — SyncEngine vs Channel**: `SyncEngine` depends on the abstract
  `Channel` interface, not `SupabaseChannel`. ✅
  Same for `SnapshotHandshake`. ✅
- **LSP — InMemoryChannel vs SupabaseChannel**:
  - `InMemoryChannel.send()` (`channel.ts:92-95`) silently no-ops when not
    subscribed; `SupabaseChannel.send()` (`supabase-channel.ts:106-117`) does
    the same. Consistent. ✅
  - `InMemoryChannel.listPresent()` returns the entire hub's presence-set,
    not scoped per-channel. The hub IS scoped (one per office in tests), so
    this works in practice, but the contract isn't documented and a misuse
    that creates two `InMemoryChannel` instances against one hub for two
    different "offices" would silently leak presence.
  - `SupabaseChannel.subscribe()` rejects on `CHANNEL_ERROR | TIMED_OUT |
    CLOSED`; `InMemoryChannel.subscribe()` cannot fail. Consumers (e.g.
    `_helpers.ts:84-108`) `await channel.subscribe()` without try/catch —
    a transient subscribe failure on Supabase will reject the harness's
    `add()` and abort the test, which is fine, but in production this same
    code path becomes the room-mount handshake. There is no retry policy in
    the adapter or above it.
  - `SupabaseChannel.knownPresenceKeys` on the `presence/leave` handler
    early-returns if the key isn't already known (`supabase-channel.ts:81-86`).
    A malformed `sync` event before any `join` could cause `leave` to be
    silently dropped. Minor.
- **ISP — Channel interface**: `Channel` (`channel.ts:6-14`) is reasonably
  small (subscribe / send / on / trackPresence / onPresenceChange / listPresent
  / close). Consumers use most of it. OK.
- **OCP — VoiceAdapter**: clean extension point (`core-refactor/src/communication/types.ts`).
  ✅ The `MockVoiceAdapter` exists; a real Jitsi adapter can be plugged in
  without touching `Communication`.
- **SRP — SyncEngine**: it does inbound, outbound, throttling, dedup, *and*
  hosts a public `applyInbound()`/`seedSeqTable()` that exists only to let
  `SnapshotHandshake` poke its internal queues. This is a leaky abstraction —
  the snapshot module reaches into the engine's private dedup table. A
  cleaner shape would hoist the dedup table into a third object (or have the
  snapshot handshake own queueing entirely and feed the engine only validated
  in-order events). The current bidirectional coupling between
  `SnapshotHandshake` and `SyncEngine` is fine but should be called out.
- **Trust-boundary validation**: `protocol.ts:62` defines
  `ZSerializedOfficeState = z.any()`. A malicious `snapshot:offer` payload
  passes Zod's envelope check then is handed to `applySnapshot` which
  unconditionally assigns its fields onto the local store. This is the only
  spot in the protocol that punches a hole through the typed boundary; the
  rest of the validation story is solid. Important.
- **Action / adapter inconsistency**: `actions.removeInventoryItem`
  (`actions.ts:115-119`) removes by `id` *or* `itemId`, but
  `MemoryPersistenceAdapter.removeInventoryItem` (`memory.ts:32-39`) removes
  by `id` only. If/when a write-through subscriber wires these together, the
  semantics diverge. Minor.
- **Naming**: `recordVersionWarning` returns `boolean` but its name suggests
  void; mutating-and-returning-a-flag from inside `setState`'s synchronous
  updater (`actions.ts:164-177`) is fragile. Minor.
- **Dead code / unused dep**: `zustand` declared but unused
  (`packages/sdk/package.json:21`).

## Test quality

- **Rule, store, bus tests** (`__tests__/game-state/*.test.ts`) test real
  behavior — emissions, ordering, isolation of throwing handlers, selector
  fan-out. Solid.
- **Protocol round-trip test** (`protocol.test.ts:135-149`) is good — it
  asserts every `NetEvent` kind has a `PROTOCOL` entry with `v + schema +
  authority`. Catches the "added a kind, forgot the schema" footgun.
- **`SyncEngine` outbound tests** (`sync-outbound.test.ts`) verify the
  position-throttling contract end-to-end (no-move = no packets, MAX_HZ
  cap, stop-packet emitted exactly once). Good.
- **`sync-inbound.test.ts:173-203`** ("applies whiteboard:stroke without
  re-broadcasting") is a tautology in part — it asserts that the only
  observed stroke event is the original from `other`, but the SyncEngine
  broadcasts only its own actor's strokes (`sync.ts:136`), so the test would
  pass even if the no-echo guard at `sync.ts:316` were removed. Marginally
  weak.
- **Snapshot-handshake test "drops live events that are already covered by
  the snapshot seqTable" (`snapshot-handshake.test.ts:110-141`) is
  load-bearing but passes only by coincidence**: it uses a single chat
  message with seq=1, where the leader's `snapshot:offer` itself has seq=1.
  After offer is applied, the SyncEngine's `inboundSeq[alice]` is set to 1
  by the offer's own dedup pass, so the replayed `seq=1` chat is dropped.
  This isn't dedup via `seqTable` — it's dedup via the offer's own envelope
  seq. With even two pre-snapshot chats, the test fails. See Critical.
- **Multi-client integration tests** (`audio-video-routing.test.ts`) use
  `prev = currentState` for `rules.tick` (`two-client.ts:117-121` and
  `audio-video-routing.test.ts:28-33`). The proximity rule correctness
  argument relies on the proximity reducer mutating `state.proximity`
  between calls — a fragile invariant that's not explicit. A rule that
  reads any other slice from `prev` would silently behave as if nothing
  ever changed.
- **Live (Supabase) integration tests** auto-skip when Supabase isn't
  running (`_helpers.ts:30-39`). They use `waitFor` polling on real time,
  not deterministic ticks — so they're race-prone in principle, but the
  5s timeouts are wide enough to absorb realtime jitter. `fileParallelism:
  false` (`vitest.config.ts:13`) is correct given they share an officeId
  namespace per test (each generates a `uniqueOfficeId`). OK.
- **Critical scenarios missing:**
  - **Simultaneous moves** (both clients write `setSelfPosition` in the
    same tick): no test covers convergence under collision.
  - **Conflicting hosts / zombie host handover** (the spec calls this out
    explicitly in 05-migration-plan.md step 11): no test.
  - **Schema-evolution forward-compat** (a `v=2` event arriving at a `v=1`
    consumer was tested for the warning, but a `v=1` event with extra
    payload fields is not).
  - **Reconnect** (`SnapshotHandshake` handling re-subscribe after a drop):
    no test.
  - **Empty `presentActors`** edge: `electLeader([], 'me')` returns null
    correctly, but the requester then sees `pending.attempt > MAX_RETRIES`
    and surrenders to empty state. No test asserts the user-visible
    surrender path beyond the timeout case.

### Critical
- **packages/sdk/src/realtime/snapshot-handshake.ts:166-180** — the
  `seqTable` packed into `snapshot:offer` is built from
  `nextSnapshotSeq - 1` (a counter that only ever increments on
  `snapshot:request`/`snapshot:offer` sends) and from `seqTable[id] = 0`
  for every other player. The SyncEngine's actual outbound `nextSeq`
  counter (`sync.ts:56`) is the source of truth for which seqs have been
  broadcast. As a result, after a snapshot is applied, replays of any
  pre-snapshot live event with `seq > 0` are *not* deduped — the test on
  line 110 of `snapshot-handshake.test.ts` passes only because it uses
  `seq=1` and the offer itself happens to have `seq=1`. Fix: source
  `seqTable` from the engine (e.g., expose `SyncEngine.snapshotOutboundSeqs():
  Record<PlayerId, number>` keyed by actorId; on the leader side that's
  `{ [selfId]: lastUsedNextSeq }` plus per-actor inbound highs for events
  the leader has already received and applied locally).
- **packages/sdk/src/realtime/protocol.ts:62** — `ZSerializedOfficeState =
  z.any()` is a real trust-boundary hole. `applySnapshot` then writes
  `snap.players`, `snap.zombies`, etc. into local store with no shape
  validation. A peer can ship `players: 'oops'` in a `snapshot:offer` and
  crash the receiver, or worse inject `players: { [selfId]: { hp: 9999, … } }`.
  Build a real Zod schema for `SerializedOfficeState` (or assemble it from
  the existing payload schemas). The fix is mechanical given the existing
  `ZVec3`, `ZAvatarData`, `ZStroke`, `ZZombieState`.

### Important
- **packages/sdk/src/test-harness/two-client.ts:117-121** — `tick()` invokes
  rules with `state` and `prev` set to the *same* current snapshot. The
  proximity rule survives this only because the proximity reducer mutates
  the slice between ticks; any rule that reads other slices from `prev`
  would silently see "nothing changed". Either snapshot the prev state at
  the start of each tick, or drop the `prev` parameter entirely from the
  harness and document that the harness uses a "current-only" tick.
- **packages/sdk/src/realtime/sync.ts:269-279** — `applyInbound` and
  `seedSeqTable` are public escape hatches for `SnapshotHandshake` to poke
  the engine's private dedup table. The two modules have a circular trust
  relationship that should be made explicit (e.g., a shared `InboundSeqTable`
  collaborator) or merged.
- **packages/sdk/src/realtime/sync.ts:330-352** — the `applyToStore` switch
  silently no-ops on `bubble:prefs`, `net:ping`, `net:pong`,
  `whiteboard:clear`, `whiteboard:undo`, `loot:open`. The protocol carries
  these kinds (so `validateNetEvent` accepts them and `versionMismatch`
  warns on version skew), but receiving any of them does *nothing*. This
  is a partial implementation hidden behind a switch — a peer that
  legitimately sends `whiteboard:clear` will simply be ignored. Either
  apply them to store / bus or drop them from the protocol union for now
  and re-add when wired.
- **packages/sdk/src/realtime/protocol.ts (no authority lint)** — the spec
  (03-realtime-layer.md §"Authority and host handover") asks for a warning
  when a `zombie:state` event arrives from a non-host actor. `SyncEngine`
  ignores authority annotations entirely.
- **packages/sdk/src/game-state/actions.ts:111-119** — `addInventoryItem`
  and `removeInventoryItem` mutate the store but do not emit
  `inventory:added` / `inventory:removed` on the bus, despite both events
  being declared in `types.ts:124-125`. Without the emission, the
  write-through pattern from 04-persistent-data-layer.md cannot be wired.
- **.github/workflows/ci.yml:31-34** — `supabase start --exclude
  edge-runtime,storage-api,imgproxy,mailpit,vector,logflare,supavisor,studio,postgres-meta`
  trims down a lot, but `supabase start` still pulls multi-GB images on a
  cold runner. CI duration-budget risk; cache the supabase docker images
  or use `supabase/setup-cli` with `--db-only` if that becomes available.
- **packages/sdk/src/realtime/supabase-channel.ts:9** — `BROADCAST_EVENT =
  'office-net-event'` is a magic string. If the production deployment ever
  forks or rolls a second mux, there's no version negotiation. Consider
  either documenting it as a wire constant or folding the protocol version
  into the broadcast event name (`office-net-event-v1`).

### Minor
- **packages/sdk/package.json:21** — `zustand` declared as a dependency but
  the store is hand-rolled and never imports it.
- **packages/sdk/src/game-state/store.ts:36** — `runtime.lastTick` field is
  initialized but never written. Either remove or wire.
- **packages/sdk/src/game-state/actions.ts:115-119** — the `removeInventoryItem`
  predicate (`i.id !== itemId && i.itemId !== itemId`) silently allows the
  caller to pass either an `id` or an `itemId`. Pick one (probably `id` for
  consistency with `MemoryPersistenceAdapter.removeInventoryItem`) and
  rename the parameter accordingly.
- **packages/sdk/src/game-state/actions.ts:107-108** — `applyHit` accepts a
  `byId` parameter, immediately discards it with `void byId`. Either thread
  it into the eventual `combat:hit` emission (rule's job, but the field
  belongs in the action signature only if it's used) or remove the parameter.
- **packages/sdk/src/realtime/sync.ts:316** — the `lastStrokeCount = …` line
  inside the `whiteboard:stroke` inbound handler is redundant given the
  outbound `subscribeAll` path will run on the same `setState` and update
  it to the same value. Defensive but dead.
- **packages/sdk/src/realtime/snapshot-handshake.ts:84-108** —
  `requestSnapshot()` returns a Promise that, on a re-entrant call, wraps
  the existing `pending.resolve` into a new resolver that calls both. The
  second caller's promise resolves *after* the first's, but if there are
  three concurrent callers the third's resolver only fires the second's
  (a recursion mistake). Edge case that only matters under concurrent
  re-requests; flag it.
- **packages/sdk/src/realtime/protocol.ts:91** — `WithEnvelope<K, V, P = {}>`
  uses `{}` as a default which is the famously-permissive empty-object type.
  Consider `Record<string, never>` for clarity.
- **packages/sdk/src/realtime/protocol.ts:111-115** — `'snapshot:offer'`'s
  `seqTable` is `Record<PlayerId, number>` but Zod validates as
  `z.record(z.string(), z.number())`. This passes validation but doesn't
  enforce the per-actor-monotonic invariant the comment in
  `snapshot-handshake.ts` claims. Document.
- **packages/sdk/src/__tests__/integration/_helpers.ts:18** — the
  hardcoded `SUPABASE_ANON_KEY` fallback is the public Supabase demo key,
  which is fine, but a CI-guarded misconfig that swaps `SUPABASE_URL` to
  a real instance would silently authenticate with the demo anon key.
  Consider failing fast if `SUPABASE_URL` is set but `SUPABASE_ANON_KEY`
  is not.
- **tools/supabase-test/supabase/migrations/** is empty. The README says
  "the integration tests don't need the production schema (they only
  exercise Realtime broadcast + presence)" — fine, but worth either
  deleting the empty `migrations/` dir or adding a `.gitkeep` with a
  comment for the next reader.

## Strengths

- The protocol round-trip test that asserts every `NetEvent` kind has a
  matching `PROTOCOL` entry (`protocol.test.ts:135-149`) is exactly the
  shape of CI lint the doc asked for. Catches the most likely regression.
- `Bus`, `Store`, and `Rule` interfaces are small, ergonomic, and the
  hand-rolled store carefully snapshots the listener set on each emit so
  unsubscribe-during-emit is safe (`store.ts:54`). That's the kind of
  detail that bites hard if missed.
- `Communication.recompute()` is correct in the case where a smaller-id
  peer arrives mid-call (`audio-video-routing.test.ts:55-61` exercises
  this) — joining the new lex-min room without leaving the old one
  separately and getting confused about whose adapter call wins.
- Auto-skip integration tests via `describe.skipIf(!supabaseUp)` plus a
  cheap `auth/v1/health` probe is the right ergonomic for a contributor
  who doesn't have Supabase running locally. Avoids the usual CI-only
  pain.
- Single broadcast event name on the Supabase channel adapter, with
  validation at the boundary (`supabase-channel.ts:64-71`), nails the
  "no `Record<string, unknown>` casts" requirement from the spec.
