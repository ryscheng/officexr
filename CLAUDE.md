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
`@officexr/sdk` + `@officexr/world` + `@officexr/studio` split is built around, and the
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
  low-level details. `@officexr/sdk` and `@officexr/core-refactor` know
  nothing about `three` or `react`; `@officexr/world` (renderer +
  physics + bots) depends on the SDK, never the reverse.
  This is enforced by greps that should stay clean:

  ```bash
  grep -rn "from 'three'" packages/sdk packages/realtime-server packages/core-refactor
  grep -rn "from 'react'" packages/sdk packages/realtime-server packages/core-refactor
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
- **Editor canvases compose renderer primitives; they don't
  re-implement them.** World objects render via
  `<ObjectInstances worldObjects={…} />`; lighting via
  `<LightingRig lighting={…} />`; preview cameras via
  `<EditorCamera />`. Editor-specific overlays (selection
  outlines, tool ghosts, hover tooltips, command-tree picking)
  layer ON TOP of those primitives — they don't replace them.
  The `lint:no-bespoke-renderer` script enforces the headline
  cases: no `SEAM_OVERLAP` anywhere, no inline `<directionalLight>`
  / `<hemisphereLight>` / `<ambientLight>` / etc. outside the
  renderer package. If you need a new primitive, add it to
  `packages/world/src/renderer/` and export it — don't fork
  it inside an editor.
- **Hermetic studio test mode (`?test=1`).** `packages/studio/src/App.tsx`
  has a startup branch: when the URL carries `?test=1`, the studio boots
  with a bundled-catalog `ApplicationApi` (no `/api/world-object-kinds`
  fetch) and in-memory storages (no `/api/*` filesystem), seeded from
  `window.__OFFICEXR_TEST_SEED__`. This is a deliberate production-code
  seam for the Playwright suite, not a stealth feature — it's a single
  branch evaluated once at boot and is null/no-op in normal operation.
  The editor document hooks resolve storage as
  `explicit option → TestStorageContext (?test=1) → Filesystem stack`.
  The hermetic harness + conventions live under
  `packages/studio/src/test-harness/` (see its README). When adding a
  new editor hook that persists, accept an optional `storage` and read
  `useTestStorages()` so it stays hermetically testable.
- **Playwright e2e tests (incl. mugshot) MUST be run after any
  change to `@officexr/world` renderer logic.** The mugshot
  baselines under `tests/playwright/mugshot-baselines/` are the
  visual contract for the renderer's positioning, scaling, and
  lighting — they will silently drift when a renderer-side
  convention changes (anchor convention, voxel size, kind AABB,
  primitive sizing, camera plumbing, etc.) and unit tests will
  not catch it because the divergence is purely pixel-level. Run
  the full e2e suite (`pnpm test:e2e`, or at minimum the mugshot
  specs `pnpm exec playwright test tests/playwright/mugshot-*`)
  before considering a renderer change complete. If a baseline
  truly needs to change, change BOTH the ideal PNGs and the
  manifest in the same PR — never silently widen the diff
  threshold to make the suite green.
- **Regenerating per-platform Playwright baselines: use podman.**
  `character-on-surface.spec.ts` uses Playwright's native
  `toHaveScreenshot`, which writes OS-suffixed baselines
  (`*-chromium-linux.png` / `*-chromium-darwin.png`). CI runs on
  linux, so its `-linux.png` baselines can't be regenerated from a
  macOS dev box directly. When they need refreshing (a renderer
  change moved the rendered pixels), regenerate them in a linux
  container via **podman** (Docker is not installed on these
  machines — prefer podman when available, `podman --version` to
  check). Use the Playwright image matching the installed version
  (`mcr.microsoft.com/playwright:v<version>-noble`) against a
  throwaway `git clone` of the repo (NOT a mount of the working
  tree — an in-container `pnpm install` would clobber the host's
  node_modules with linux binaries), then copy the generated
  `*-chromium-linux.png` back into
  `tests/playwright/<spec>-snapshots/`. Review each PNG by hand
  before committing.
