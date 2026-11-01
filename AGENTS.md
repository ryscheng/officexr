# OfficeXR — Agent & Developer Guide

## Project Overview

OfficeXR is a 3D virtual office with real-time presence, proximity voice chat, and
per-office characters. The codebase is a **pnpm workspaces monorepo** whose deployables
are the web SPA build (`@officexr/web`) and its backend (`@officexr/server`);
`@officexr/studio` is the authoring tool for the maps, rooms and object kinds the web
app renders.

> **Package manager: pnpm.** Always use `pnpm` — do not use `npm` or `yarn`.
> Workspace config lives in `pnpm-workspace.yaml`; cross-package deps use the `workspace:*` protocol.

---

## Repository Structure

```
officexr/
├── packages/
│   ├── web/              # @officexr/web — office app (SPA only)
│   │   ├── index.html    # SPA shell (entry: src/main.tsx)
│   │   ├── src/          # App.tsx (routing), home/ (office list + create form), room/ (OfficeWorld, session, characters),
│   │   │                 # hud/ (chat), voice/ (JaaS proximity voice)
│   │   └── vite.config.ts # dev only: mounts @officexr/server's app and an in-process realtime office
│   ├── server/           # @officexr/server — web backend
│   │   ├── src/          # main.ts (entrypoint), backend.ts (createBackend: db + realtime + app, shared with `pnpm dev`), app.ts (createApp), api.ts (/api/*), auth.ts (Google login, logout), db.ts (pg),
│   │   │                 # sessionPolicy.ts, runtimeConfig.ts (/config.js), staticDir.ts (/models), shared.ts (browser-safe types/limits); vitest specs
│   │   └── .env.example  # SUPABASE_DB_URL, GOOGLE_*, SESSION_SECRET, PUBLIC_URL, PORT, ADMIN_PORT, OFFICEXR_DEV_USER_*, VITE_JAAS_*, OFFICEXR_ASSET_BASE_URL
│   ├── world/            # @officexr/world — renderer, physics, bots, maps/rooms/cube kinds
│   ├── studio/           # @officexr/studio — map/room/object/character/debug editors
│   ├── studio-server/    # @officexr/studio-server — studio backend: main.ts (entrypoint), app.ts (internal + public servers),
│   │                     # studio-backend.ts (storage hooks + R2 sync, shared with the Vite studio), r2-publisher.ts, push-world-constants.ts
│   ├── studio-mcp/       # @officexr/studio-mcp — MCP server at /mcp (tools, render_view)
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

- **Identity.** Users sign in with Google. The server keeps a Postgres-backed session
  (the `session` table), identifies the user by their verified Google email, and exposes
  it at `/api/me` (401 `{ error: 'Not signed in' }` when signed out). Only emails or
  domains in the SQL-managed `login_allowlist` table may sign in. The web app shows a
  sign-in screen on a 401 and a Sign out button on the home page (`POST /auth/logout`).
  The server never trusts client-supplied identity headers.
- **Backend.** `@officexr/server` is one Node process (`pnpm --filter @officexr/server start`).
  `PORT` (default 4173) serves the API, Google auth, read-only studio data, `/models`,
  `/config.js`, and an attached `RealtimeServer` (`/ws`, `/health`, `/rooms/:id/sessions`);
  it serves no SPA, so `GET /` is a 404. `ADMIN_PORT` (default 8787) serves only
  `PUT /admin/world-constants`. `pnpm dev` mounts the same `createBackend` in Vite's dev server.
  The SPA imports only `@officexr/server/shared`, which must stay free of Node and server deps.
- **Studio backend.** `@officexr/studio-server` is one Node process
  (`pnpm --filter @officexr/studio-server start`; run `pnpm --filter @officexr/studio build` first).
  `PORT` (default 5174) serves the built studio SPA, read/write `/api/*`, `/models` and `/mcp`,
  unauthenticated, for in-cluster callers (the bots sidecar, private-ops-center).
  `PUBLIC_PORT` (default 5175) serves `/api/*` and `/models`, and proxies `/health` and `/ws` to
  `REALTIME_SERVER_TARGET` (default `http://127.0.0.1:8787`); everything else is a 404. The public
  port is **unauthenticated until the studio auth gate lands — do not expose it**. Both ports share
  one storage instance, so save hooks fire once per write. Other env: `OFFICEXR_STUDIO_DATA_DIR`
  (seeded from `packages/world` on first boot), `OFFICEXR_WORLD_CONSTANTS_PUSH_TARGETS` +
  `OFFICEXR_REALTIME_ADMIN_TOKEN`, `OFFICEXR_R2_*`, `OFFICEXR_RENDER_CHROMIUM_PATH`.
  `pnpm --filter @officexr/studio dev` keeps running the same storage, MCP and hooks inside Vite.
- **Database.** The backend (`packages/server/src/db.ts`) reads and
  writes Postgres via `pg` using `SUPABASE_DB_URL`; the browser never talks to the
  database. Offices and per-office character choices live there.
- **World.** A room renders the office's studio map through `@officexr/world`
  (`<Scene>`, physics, characters). The headless state and protocol live in
  `@officexr/sdk`; `@officexr/core-refactor`'s `createStack` builds the channel +
  voice adapter for a session.
- **Realtime.** Presence, position and chat sync go over a `WsChannel` to the
  `@officexr/realtime-server` instance the backend runs in-process. `pnpm dev` runs its
  own, so web dev no longer shares an office with `pnpm bots:start` or the studio. The
  studio debug mode uses the same stack with an in-memory or WebSocket channel.
- **Voice.** Proximity voice uses JaaS (Jitsi as a Service) rooms, with the JWT minted
  in the browser from the `VITE_JAAS_*` values served at `/config.js`.

---

## Commands

```bash
pnpm dev          # Start web dev server (Vite, http://localhost:5173) with the backend in-process
pnpm build        # Build the web SPA (outputs to packages/web/dist/)
pnpm preview      # Preview the SPA build (static only: no API)
pnpm --filter @officexr/server start   # Production backend on :4173, admin on :8787
pnpm --filter @officexr/studio-server start   # Studio backend: internal :5174, public :5175
pnpm typecheck    # Typecheck every package
pnpm test         # Unit tests for every package
pnpm test:e2e:ci  # Hermetic Playwright suite run in CI
pnpm --filter @officexr/realtime-server start   # Realtime server on :8787
```

---

## Environment Variables

### Web backend (`packages/server/.env.example`)

Identity comes from Google sign-in: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`SESSION_SECRET` (signs the session cookie) and `PUBLIC_URL` (the external origin, no
trailing slash; the Google OAuth redirect URI is `${PUBLIC_URL}/auth/google/callback`).
`pnpm --filter @officexr/server start` refuses to boot unless all four are set. When `PUBLIC_URL` is
https the session cookie is Secure, so the TLS terminator must send
`X-Forwarded-Proto: https`. Who may sign in is managed with SQL in `login_allowlist`
(values lowercase, no admin UI; example inserts in the README "Sign-in" section). The server reads offices from Postgres via
`SUPABASE_DB_URL`. Run `pnpm db:migrate` (applies `supabase/migrations` to
`SUPABASE_DB_URL`) before `start`. The server listens on `PORT` (default 4173) and
`ADMIN_PORT` (default 8787, `PUT /admin/world-constants` behind `OFFICEXR_REALTIME_ADMIN_TOKEN`);
that default clashes with a local realtime CLI or `pnpm bots:start`, so set `ADMIN_PORT` to run
both. `OFFICEXR_WORLD_CONSTANTS_URL` defaults to its own `/api/world-settings`.
For local dev set `OFFICEXR_DEV_USER_LOGIN` / `OFFICEXR_DEV_USER_NAME`; `pnpm dev` (never
`start`) then treats every request as that user and needs no Google variables.
Optional `OFFICEXR_ASSET_BASE_URL` (served at `/config.js`) loads `/models` assets and baked
layouts from that base URL (e.g. a CDN); unset keeps same-origin paths.

Copy `packages/server/.env.example` to `packages/web/.env` for `pnpm dev`, which loads
`.env` from `packages/web/`; `start` reads only the process environment.

### Realtime server (`packages/realtime-server`)

Optional `OFFICEXR_REALTIME_TOKEN_SECRET` makes the server require an HMAC-signed join token
(minted with `signJoinToken` from `@officexr/realtime-server/join-token`) on every `hello` and
on `GET /rooms/:id/sessions?login=…&token=…`; the login is taken from the token. Unset keeps
today's unauthenticated behaviour. The studio has no login, so it must point at a realtime
server without the secret. The web backend needs the same value (see `packages/server/.env.example`);
it mints the tokens at `GET /api/realtime-token`.

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
