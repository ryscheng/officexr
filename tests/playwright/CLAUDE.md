# CLAUDE.md — Playwright e2e, and the Mugshot gravity contract

General Playwright guardrails (baselines, podman, mugshot vs native
screenshots) live in the repo-root [`CLAUDE.md`](../../CLAUDE.md). This
file captures the one contract that's easy to break silently: **how the
Mugshot places its character, and what the Y-offset slider is for.**

## The Mugshot places the character by GRAVITY, never by an offset

`packages/studio/src/modes/mugshot/MugshotApp.tsx` drops the character
body from `SPAWN_DROP_HEIGHT` above the 2×2 cube cluster and lets it
**settle onto the cubes under the kinematic character controller** —
the same physics Debug mode uses. The rendered resting height is
whatever gravity produces (≈ root y 0.50, feet flush on the cube tops
at y=1), not a hand-tuned constant.

There used to be a cheat here: gravity was disabled on mount and the
body was teleported to a `DEFAULT_Y_OFFSET` constant. That is gone.
**Do not bring it back.** If you find yourself wanting to teleport the
body to a magic Y to "fix" placement, the bug is in gravity/geometry —
fix that instead.

The character settles flush because the kinematic controller's
penetration skin is **near-zero globally** —
`CHARACTER_CONTROLLER_SKIN` in `packages/world/src/physics/rules.ts`,
used by BOTH the local player (`SceneFrame`) and bots
(`BotPhysicsWorld`). Nothing about physics is mugshot-scoped: every
character in the game settles on the ground the same way. (A larger
"anti-tunnel" skin would float the collider ~1 cm above every surface;
the world's solid 2 m cubes make tunneling at a near-zero skin a
non-issue.) If you change that constant, expect every character
baseline to shift.

### The invariant (`mugshot-gravity-invariant.spec.ts`)

After settling, the character's feet must rest within **10 cm**
(`MAX_GROUND_SINK`) of the cube surface, in both cube modes. If that
spec fails, **gravity handling has regressed**. The fix is a
bug-finding mission on placement — NOT raising the cap, NOT adding a
position offset, NOT re-introducing the teleport. The 10 cm cap is
inviolable; raising it is itself the red flag.

## The Y-offset slider is a HUMAN diagnostic, not a placement mechanism

The Mugshot is a tool a human uses to *eyeball* character placement and
guide a future agent when gravity rendering breaks. For that, the
control panel keeps a **Y-offset slider** that is a deliberate **manual
override**:

- By default (`manualPlacement === false`) gravity owns the body; the
  slider is inert (display only).
- The moment a human drags the slider — or a test calls
  `__OFFICE_MUGSHOT_SET_Y_OFFSET__` — the Mugshot enters **manual
  mode**: gravity is suspended and the body is pinned at the slider
  value, so the human can lift/lower the character to inspect placement
  when the gravity render looks wrong. The "Auto (gravity)" button
  drops the pin and re-settles under gravity.

**officexr itself MUST NOT rely on this offset to position the
character** — that is gravity's job. The slider exists *only* for the
human operating the Mugshot. `__OFFICE_MUGSHOT_APPLY_MANIFEST__` clears
manual mode (manifests carry no Y), so the compare baselines always
assert the natural gravity-settled placement.

## Mugshot fixtures must keep colliders == meshes

The compare scene's cubes are a deliberate A/B diagnostic (GLB vs inline
primitive box). Under gravity the character rests on the **colliders**,
so a collider that doesn't match its visible mesh makes the character
float or fall through:

- `stone` is pinned to exactly 2.0 m in `world-object-kinds.json` (the
  raw GLB bakes to 2.02, which floated the character 2 cm).
- `__primitive_*` magic kinds get their 2 m collider from
  `geometry-service.ts` (`PRIMITIVE_BLOCK_SIZE`), matching the box
  `ObjectInstances` renders — otherwise they fall back to a 0.5 m
  collider and the character drops through them.

If you change cube geometry, re-run the mugshot specs and re-curate the
ideals (`mugshot-baselines/<Char>/ideal/`) from the in-app Export.
