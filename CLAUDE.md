# CLAUDE.md — agent guardrails

Project orientation lives in [`AGENTS.md`](./AGENTS.md). The architecture
overview lives in [`ARCHITECTURE.md`](./ARCHITECTURE.md). The active
refactor design docs live under [`refactor-plan/`](./refactor-plan/).
Read those first if you're new to the codebase.

This file captures things that aren't about *what* the system does, but
about *how* code in it should be written. Keep it short.

## SOLID is the default architecture

Default to writing code that respects the five SOLID principles. They're
not aspirational rules — they're the baseline the existing
`@officexr/sdk` + `debug-app` split is built around, and the
`refactor-plan/` work is explicitly aimed at restoring them where the
old `RoomScene.tsx` god component eroded them.

- **Single Responsibility.** A module, class, or component does one
  thing. If you can't describe its job in one short sentence without
  using "and", split it. Concrete examples in this repo: `SyncEngine`
  delegates to `PositionBroadcaster` + `StateDiffBroadcaster` +
  `InboundRouter`; `BotDriver` delegates to `BotPhysicsWorld` + per-mode
  strategy files in `bot/modes/`; `Scene.tsx` delegates Leva panels to
  per-panel hooks in `renderer/panels/`.
- **Open/Closed.** Prefer adding a new file (a new mode strategy, a new
  panel, a new `NetEvent` kind) to editing an existing switch/giant
  function. Strategy tables (`BOT_MODE_STRATEGIES: Record<BotMode, …>`)
  and the `PROTOCOL` table are existing examples — they fail at compile
  time when a new variant is added without a registry entry.
- **Liskov Substitution.** A concrete `Channel` implementation
  (`InMemoryChannel`, `WsChannel`, `SupabaseChannel`) must obey the
  same observable contract the `Channel` interface advertises —
  including subscribe / send / presence semantics. Any "this
  implementation behaves slightly differently" needs to either be
  surfaced in the interface or eliminated.
- **Interface Segregation.** Don't make a caller depend on more than it
  uses. `WorldSettings` is now an intersection of `AnimationSettings &
  ProximitySettings & CollisionSettings & …` precisely so a function
  that only needs movement tunables can ask for `AnimationSettings &
  CollisionSettings` instead of the whole bag.
- **Dependency Inversion.** High-level modules don't depend on
  low-level details. `@officexr/sdk` knows nothing about `three` or
  `react`; the renderer + HUD depend on the SDK, never the reverse.
  This is enforced by greps that should stay clean:

  ```bash
  grep -rn "from 'three'" packages/sdk packages/realtime-server
  grep -rn "from 'react'" packages/sdk packages/realtime-server
  ```

  Both must return zero matches.

## When you violate SOLID, document the reason inline

Some violations are deliberate — a framework constraint, a perf budget,
a behaviour-preserving shim during migration. That's fine. **What's not
fine is a silent violation.** When you knowingly bend one of the rules
above, leave a comment at the violation site that says:

1. **Which principle** is being bent (SRP / OCP / LSP / ISP / DIP).
2. **Why** — the constraint that forced the choice (existing API,
   third-party library shape, perf, migration step, etc.).
3. **What would need to change** to remove the violation, if anything.

Example shape (don't copy verbatim, adapt to the situation):

```ts
// SRP violation: this hook owns both the Leva controls AND the
// mirror into actions.setWorldSettings. The panels SDK boundary
// forces this — Leva's `useControls` must be called from the same
// component that renders the panel root, so splitting "panel UI" and
// "broadcast" into two modules would require a Leva fork. Acceptable
// scope for a single per-panel file.
```

Comments like that turn a code smell into a reviewed, traceable
decision. Comments like `// hack` or no comment at all turn it into
tech debt that compounds.

If a SOLID violation has *no* good reason — i.e. you'd just rather not
do the split — fix it instead of documenting it. The doc-the-reason
escape hatch is for genuine constraints, not for skipping refactors.

## Other guardrails

- **No mock-only tests for cross-process behaviour.** If a test would
  pass with mocked Supabase / mocked channels but fail in production,
  add an integration test against the in-memory channel hub
  (`createInMemoryChannelHub`) — that's the convergence-test pattern
  the SDK already uses.
- **No new `import * as THREE` outside `packages/*/renderer/**`.**
  Hooks and SDK code stay headless. This is the same constraint
  spelled out in `refactor-plan/00-overview.md §"Hard rules"`.
- **No new `useRef + setStateSync` mirror pairs.** They were the
  load-bearing footgun that ARCHITECTURE.md observation O3 calls out.
  Use the store or a `subscribeAll` listener instead.
