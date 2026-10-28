# OfficeXR — Agent & Developer Guide

## Project Overview

OfficeXR is a 3D virtual office with real-time presence, proximity voice chat, and
per-office characters. The codebase is a **pnpm workspaces monorepo** whose single
deployable app is the web build (`@officexr/web`); `@officexr/studio` is the authoring
tool for the maps, rooms and object kinds the web app renders.

> **Package manager: pnpm.** Always use `pnpm` — do not use `npm` or `yarn`.
> Workspace config lives in `pnpm-workspace.yaml`; cross-package deps use the `workspace:*` protocol.

---

## Repository Structure

```
officexr/
├── packages/
│   ├── web/              # @officexr/web — office app
│   │   ├── index.html    # SPA shell (entry: src/main.tsx)
│   │   ├── src/          # App.tsx (routing), home/ (office list + create form), room/ (OfficeWorld, session, characters),
│   │   │                 # hud/ (chat), voice/ (JaaS proximity voice)
│   │   ├── server/       # /api/me, /api/offices (list + create), /api/offices/:id/character (pg), /config.js; vitest specs
│   │   ├── vite.config.ts
│   │   └── .env.example  # SUPABASE_DB_URL, OFFICEXR_DEV_USER_*, VITE_JAAS_*, OFFICEXR_ASSET_BASE_URL
│   ├── world/            # @officexr/world — renderer, physics, bots, maps/rooms/cube kinds
│   ├── studio/           # @officexr/studio — map/room/object/character/debug editors
│   ├── sdk/              # @officexr/sdk — headless game state, realtime protocol, Channel
│   ├── core-refactor/    # @officexr/core-refactor — createStack, office session, voice adapters
│   └── realtime-server/  # @officexr/realtime-server — WebSocket relay + WsChannel
├── supabase/migrations/  # SQL migrations (applied with `pnpm db:migrate`)
├── tests/playwright/     # Playwright e2e specs
├── .github/workflows/
│   ├── ci.yml                  # typecheck, build, unit tests, hermetic e2e
│   └── supabase-migrations.yml # Applies migrations on push to main + workflow_dispatch
├── pnpm-workspace.yaml   # Workspace package globs
├── tsconfig.json         # Root: IDE project references only
└── AGENTS.md             # This file
```

---

## How the web app fits together

- **Identity.** There is no auth in the app. The server trusts the
  `Tailscale-User-Login` / `Tailscale-User-Name` headers added by Tailscale Serve and
  exposes them at `/api/me`.
- **Database.** The web server (a Vite plugin, `packages/web/server/api.ts`) reads and
  writes Postgres via `pg` using `SUPABASE_DB_URL`; the browser never talks to the
  database. Offices and per-office character choices live there.
- **World.** A room renders the office's studio map through `@officexr/world`
  (`<Scene>`, physics, characters). The headless state and protocol live in
  `@officexr/sdk`; `@officexr/core-refactor`'s `createStack` builds the channel +
  voice adapter for a session.
- **Realtime.** Presence, position and chat sync go over a `WsChannel` to
  `@officexr/realtime-server`; the web server proxies `/ws` to it
  (`REALTIME_SERVER_TARGET`, default `http://127.0.0.1:8787`). The studio debug mode
  uses the same stack with an in-memory or WebSocket channel.
- **Voice.** Proximity voice uses JaaS (Jitsi as a Service) rooms, with the JWT minted
  in the browser from the `VITE_JAAS_*` values served at `/config.js`.

---

## Commands

```bash
pnpm dev          # Start web dev server (Vite, http://localhost:5173)
pnpm build        # Build web (outputs to packages/web/dist/)
pnpm preview      # Preview the production web build
pnpm typecheck    # Typecheck every package
pnpm test         # Unit tests for every package
pnpm test:e2e:ci  # Hermetic Playwright suite run in CI
pnpm --filter @officexr/realtime-server start   # Realtime server on :8787
```

---

## Environment Variables

### Web (`packages/web/.env`)

Identity comes from the `Tailscale-User-Login` / `Tailscale-User-Name` headers (no auth
in the app); the server reads offices from Postgres via `SUPABASE_DB_URL`. Run
`pnpm db:migrate` (applies `supabase/migrations` to `SUPABASE_DB_URL`) before `start`.
For local dev set `OFFICEXR_DEV_USER_LOGIN` / `OFFICEXR_DEV_USER_NAME`; the dev server
injects them as the Tailscale headers (never in preview).
The identity headers are trusted only because the server is reachable solely through the
Tailscale ingress; direct access to the pod port would allow spoofing them.
Optional `OFFICEXR_ASSET_BASE_URL` (served at `/config.js`) loads `/models` assets and baked
layouts from that base URL (e.g. a CDN); unset keeps same-origin paths.

Copy from `packages/web/.env.example`. Vite loads `.env` from `packages/web/` when
`pnpm dev` / `pnpm build` are run inside that package.

### Realtime server (`packages/realtime-server`)

Optional `OFFICEXR_REALTIME_TOKEN_SECRET` makes the server require an HMAC-signed join token
(minted with `signJoinToken` from `@officexr/realtime-server/join-token`) on every `hello` and
on `GET /rooms/:id/sessions?login=…&token=…`; the login is taken from the token. Unset keeps
today's unauthenticated behaviour. The studio has no login, so it must point at a realtime
server without the secret.

---

## Studio Editors (5 modes)

The studio (`@officexr/studio`) at `pnpm --filter @officexr/studio dev` is
restructured into five purpose-built modes, each a separate App under
`packages/studio/src/modes/<name>/`:

| Mode      | Hash      | Purpose                                                  |
|-----------|-----------|----------------------------------------------------------|
| Map       | `#map`    | Compose Rooms into a world — placement, rotation, spawn points, environment (sun/sky/stars/HDRI) |
| Room      | `#room`   | Author a single Room: Select / Add / Delete / Tile tools, multi-select + groups, point-and-click cube placement |
| Object    | `#object` | Tune every cube kind: label, swatch, walkable, scale, tint, opacity, roughness, metalness, emissive |
| Character | `#character` | Character previewer + per-model tuning                |
| Debug     | `#debug`  | Playtest: pick a map, bots spawn at the map's spawn points, Reset & respawn warps everyone |

Storage endpoints (Vite middleware):
- `/api/rooms/:name` — RoomDocument JSON
- `/api/maps/:name` — MapDocumentV2 JSON (v1 maps are migrated on server start and on PUT)
- `/api/cube-kinds` — single-doc catalog GET/PUT
- `/api/world-settings` — single-doc `WorldConstants` GET/PUT; a save is pushed to the realtime servers (502 `{failed}` when some push fails)

Files on disk:
- `packages/world/rooms/*.json`
- `packages/world/maps/*.json` (`default.json` is the seed)
- `packages/world/cube-kinds.json` (+ `cube-kinds.default.json` fallback)

### Studio control kit

Every panel uses an in-house control kit at
`packages/studio/src/ui/controls/` built on shadcn-style wrappers
around Radix primitives (slider, select, switch, collapsible, popover,
tooltip, label) plus `react-colorful` for color pickers. The base
shadcn components live at `packages/studio/src/components/ui/`.
Styling is Tailwind v4 (configured via `@tailwindcss/vite`); tokens
match the dark studio palette and are declared in
`packages/studio/src/styles/globals.css`.

Key controls:
- `<NumberInput>` — slider + draggable scrubber + click-to-type
  (drag-to-scrub uses `useDragScrub`; shift = ×10, alt = ×0.1).
- `<ColorInput>` — `react-colorful` HexColorPicker in a Popover.
- `<Vector3Input>` — three scrubbers side-by-side.
- `<NullableField>` — checkbox + slotted control for `tint`/
  `roughness`/`metalness`/`emissive` "use X" pairs.
- `<Section>` — Radix Collapsible with an optional enable-toggle.

Every value is fully controlled — there is no module-level store
backing any of the panels. The previous Leva-based stack has been
removed entirely; `pnpm --filter @officexr/studio lint:leva-free`
runs four greps and fails CI if any Leva references leak back in.

The Debug tuning panels (Bot, Animation, Jump, Proximity, Lighting,
Background, FixedCamera, Settings) live at
`packages/studio/src/panels/world/`. Every section but Bot edits the
store's `worldConstants`; `useWorldConstantsPersistence` loads the saved
document on start and saves (`/api/world-settings`) 500 ms after the last
edit. Bot count/mode stay studio-local (`useStudioSettings`). In the
in-memory stack a small authority re-emits the constants as the server
actor so in-browser bots follow them.

## Studio Asset Packs

The studio's Object editor + Room editor catalog references three KayKit FREE
packs (Furniture, Prototype, Restaurant) hosted on Cloudflare R2. The `.gltf`
binaries are gitignored — the matching catalog entries in
`packages/world/cube-kinds.json` ARE committed. After cloning, populate the
binaries locally:

```bash
pnpm asset-packs:install        # idempotent; add --force to redownload
```

This downloads the three zip files, unzips them into
`packages/studio/public/models/{furniture,prototype,restaurant}/`, enumerates
the `.gltf` files, and appends any not-yet-known entries to
`cube-kinds.json`. Re-running with no new packs is a no-op.

If you skip the install step, the catalog still loads but
`useGLTF(...)` will 404 on any furniture / prototype / restaurant kind your
scene references. The original 12 KayKit BlockBits ship in-repo so the
default Scenes / Debug paths work without the install step.

## Database Migrations

SQL migrations live in `supabase/migrations/`. Apply them to `SUPABASE_DB_URL` with:

```bash
pnpm db:migrate           # supabase db push against SUPABASE_DB_URL
```

The web container runs `pnpm db:migrate` before starting the server.
