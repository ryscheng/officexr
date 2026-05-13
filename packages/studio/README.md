# @officexr/studio

The OfficeXR authoring tool. Top header with three tabs:

- **Scenes** — CAD-like map editor. Pick a cube kind from the left
  palette, click the floor to place, click a face to extrude.
  Free-fly camera (WASD/QE + drag-to-look + scroll dolly). Maps
  persist as a command-list JSON in `packages/world/scenes/` via the
  `vite-plugin-scene-storage` middleware.
- **Characters** — single-character previewer + per-model tuning.
  Pick a model, scrub through animation states (Idle / Walking /
  Running / Jumping / Shooting / Throwing), or take control with
  WASD. The collapsible Tuning section overrides per-character
  speed / collision / animation playback (saved to localStorage).
- **Debug** — original multiplayer scene with the full SDK stack:
  bots, networked peers, the Leva debug panels. Used to debug
  gameplay and the network protocol; consumes the editors' on-disk
  output (loads scenes + character configs and broadcasts via the
  existing `world:objects` / `world:characters` NetEvents).

The three modes are completely separate applications mounted under
the shared header. Scenes & Characters editors don't touch the SDK
store, the SyncEngine, or the WebSocket — they're standalone
authoring tools that write to disk.

## Starting the studio

```bash
pnpm --filter @officexr/studio dev
```

Then open `http://localhost:5174` in a browser.

## Bot controls (Debug only)

The **Bot Controls** Leva panel appears when the Debug tab is active.
The Node bot CLI runs as a child of the dev server automatically
(`@officexr/world/vite-plugin-bots`). For log isolation, you can also
run the CLI yourself in a separate terminal:

```bash
pnpm --filter @officexr/world bots:start
```

The plugin probes the `/health` endpoint on `:8787` and skips
spawning when it sees an existing instance.

## Scenes editor controls

| Action | Effect |
|---|---|
| Click a swatch in the left palette | Stage that cube kind |
| Click the floor with a kind staged | Place a `placeCube` command |
| Click an existing cube | Select it (highlights yellow) |
| Click a face on the SELECTED cube | Extrude it in that direction by the count in the inspector |
| Click any cube in the History list | Refocus selection |
| Delete (Inspector button) | Remove the command (and any extrudes targeting it) |

| Camera | Effect |
|---|---|
| WASD / QE / Shift | Strafe through space (Shift = 3× speed) |
| Drag (no pointer lock) | Rotate the view |
| Scroll wheel | Dolly forward / back |

## Characters editor controls

| Action | Effect |
|---|---|
| Pick a model | Adventurer reloads |
| Click an animation-state button | Plays that clip on loop (or once + clamp for non-locomotion states) |
| Take control toggle | WASD walks the character; state buttons disable while motion drives the clip |
| Tuning sliders | Save per-model overrides to localStorage |

| Camera | Effect |
|---|---|
| Drag | Orbit around the character |
| Scroll | Zoom in / out |
| WASD (control mode) | Move the character; camera follows |

## Running tests

```bash
pnpm --filter @officexr/studio test       # studio integration
pnpm --filter @officexr/world test        # renderer / scenes / bots
pnpm --filter @officexr/sdk test          # protocol / store / sync
pnpm --filter @officexr/core-refactor test  # voice / communication
```

## Architecture note

Studio is a thin shell. All renderer code, character registry, and
scene serialization live in `@officexr/world`. The production
`@officexr/web` package is untouched — it still depends on
`@officexr/core`'s legacy `RoomScene.tsx`. The eventual `web`
migration will swap `core` for `@officexr/world` (renderer) plus a
future HUD package; the studio path is what proves those seams.
