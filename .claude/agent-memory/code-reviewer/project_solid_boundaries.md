---
name: project-solid-boundaries
description: Hard-rule package boundaries to grep for in officexr reviews — DIP enforcement points
metadata:
  type: project
---

CLAUDE.md at repo root defines two greps that MUST return zero matches:

```
grep -rn "from 'three'" packages/sdk packages/realtime-server packages/core-refactor
grep -rn "from 'react'" packages/sdk packages/realtime-server packages/core-refactor
```

Additionally, `packages/world/src/scenes/` and its sibling data-only dirs should
have NO `three` or `react` imports — they're authoring data layer, headless by
design. `import * as THREE` is restricted to `packages/*/renderer/**`.

**Why:** The refactor-plan/ work is explicitly aimed at restoring SOLID's
Dependency Inversion after `RoomScene.tsx` god component eroded it. The SDK
must remain headless so it can be embedded by other clients (server, tests,
future native).

**How to apply:** Whenever reviewing files under `packages/world/src/scenes/`,
`packages/sdk/`, `packages/realtime-server/`, or `packages/core-refactor/`, run
the grep before approving. Also check the new file's own imports against this
rule. See [[project-studio-restructure]] for the in-flight 15-task plan that
expands this boundary.
