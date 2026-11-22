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
│   │   ├── src/          # App.tsx (routing), home/ (office list + create form), page/ (shell for pages outside the world), room/ (OfficeWorld, session, characters),
│   │   │                 # hud/ (chat, roster, zoom; hud/ui/ is the shared control kit), voice/ (JaaS proximity voice)
│   │   └── vite.config.ts # dev only: mounts @officexr/server's app and an in-process realtime office
│   ├── server/           # @officexr/server — web backend
│   │   ├── src/          # main.ts (entrypoint), backend.ts (createBackend: db + realtime + app, shared with `pnpm dev`), app.ts (createApp), api.ts (/api/*), auth.ts (Google login, logout), db.ts (pg),
│   │   │                 # jaasToken.ts (server-side JaaS JWT signing), runtimeConfig.ts (/config.js), staticDir.ts (/models), listen.ts, shared.ts (browser-safe types/limits); vitest specs
│   │   └── .env.example  # SUPABASE_DB_URL, GOOGLE_*, SESSION_SECRET, PUBLIC_URL, PORT, ADMIN_PORT, OFFICEXR_DEV_USER_*, VITE_JAAS_APP_ID, OFFICEXR_JAAS_* (server-only), OFFICEXR_ASSET_BASE_URL, CALENDAR_ENCRYPTION_SECRET, SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET
│   ├── world/            # @officexr/world — renderer, physics, bots, maps/rooms/cube kinds; top-down/ is the three-free
│   │                     # entry the web HUD imports hooks from
│   ├── studio/           # @officexr/studio — map/room/object/character/debug editors
│   ├── studio-server/    # @officexr/studio-server — studio backend: main.ts (entrypoint), app.ts (internal + public servers), studio-gate.ts (public-port sign-in gate),
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
  `/config.js`, and an attached `RealtimeServer` (`/ws`, `/health`, `/ready`, `/version`, `/rooms/:id/sessions`);
  it serves no SPA, so `GET /` is a 404. `ADMIN_PORT` (default 8787) serves only
  `PUT /admin/world-constants`. `pnpm dev` mounts the same `createBackend` in Vite's dev server.
  The SPA imports only `@officexr/server/shared`, which must stay free of Node and server deps.
- **Studio backend.** `@officexr/studio-server` is one Node process
  (`pnpm --filter @officexr/studio-server start`; run `pnpm --filter @officexr/studio build` first).
  Both ports proxy `/health`, `/version` and `/ws` to `REALTIME_SERVER_TARGET` (default `http://127.0.0.1:8787`).
  `PORT` (default 5174) also serves the built studio SPA at `/studio/` (`/` redirects there), read/write `/api/*`, `/models` and `/mcp`,
  unauthenticated, for in-cluster callers (the bots sidecar, private-ops-center).
  `PUBLIC_PORT` (default 5175) also serves `/api/*` and `/models`, and (when the OAuth server is on) `/mcp`; everything else is a 404 for a signed-in user and a 401 from the gate otherwise. The public
  port (`studio-gate.ts`) requires the web backend's session cookie for a login on the SQL-managed
  `studio_allowlist` (as well as `login_allowlist`, to sign in) on every request and `/ws` upgrade, and
  serves `GET /api/me` (200 / 401 / 403). `/api/*` (not `/models`, `/ws` or `/mcp`) also accepts a studio API JWT as `Authorization: Bearer` (`agent-tokens/`): the token acts as its user, who must be on both `studio_allowlist` and `admin_allowlist` (re-checked per request); an invalid token is a 401 with no cookie fallback, any Bearer header is a 401 when agent tokens are disabled, and bearer requests get 403 on `/api/agent-token-requests`. A Bearer that verifies as the web backend's preview token (on any path, or `?officexr_token=` on a `/ws` upgrade) is checked first and acts like the session cookie (`studio_allowlist` only, approval routes allowed); it needs `OFFICEXR_WEB_PUBLIC_URL`, its issuer. The SQL-managed `admin_allowlist` table names the logins allowed to authorize MCP OAuth clients (`/mcp`). With both `STUDIO_PUBLIC_URL` (the public port's external origin, the OAuth issuer; `/mcp` under it is the only token `resource`) and `OFFICEXR_WEB_PUBLIC_URL` (the web backend's `PUBLIC_URL`, whose `/auth/google` signs admins in) set, the public port also serves an MCP OAuth server (`src/oauth/`) ahead of the gate: metadata, `/authorize` with an admin consent page, `/token`, `/register` and `/revoke`, plus `/mcp` itself (the studio MCP, OAuth bearer tokens only: no session cookie or `studio_allowlist`; the token's login must still be on `admin_allowlist` and its audience exactly `${STUDIO_PUBLIC_URL}/mcp`; it shares one `StudioMcpOptions`, lock and bake jobs with the internal port's `/mcp`, whose loopback and `render_view` target the internal port). Without OAuth the public port has no `/mcp` route, so it falls to the gate (401 anonymous, 404 signed in). Each of `STUDIO_PUBLIC_URL` and `OFFICEXR_WEB_PUBLIC_URL` must be a plain origin (no path or trailing slash). With neither it is off; with only one, or a non-origin, the server refuses to start. The sign-in round trip needs the web backend's `FRONTEND_ORIGINS` to include `STUDIO_PUBLIC_URL`, or `safeReturnTarget` drops the `next=` back to `/authorize`. It needs `SESSION_SECRET`, `SUPABASE_DB_URL` and `COOKIE_DOMAIN`
  matching the web backend, plus `FRONTEND_ORIGINS` (CORS; the first origin sets cookie `secure` and must sit
  under `COOKIE_DOMAIN`); example insert in the README. Both ports share
  one storage instance, so save hooks fire once per write. Other env: `OFFICEXR_STUDIO_DATA_DIR`
  (seeded from `packages/world` on first boot), `OFFICEXR_WORLD_CONSTANTS_PUSH_TARGETS` +
  `OFFICEXR_REALTIME_ADMIN_TOKEN`, `OFFICEXR_R2_*`, `OFFICEXR_RENDER_CHROMIUM_PATH`, and `OFFICEXR_MODEL_SOURCES_BUCKET` + `OFFICEXR_MODEL_SOURCES_SIGNER_EMAIL` (set together; private GCS model sources, `model-sources/store.ts`, the bake `sourceReader`; upload URLs are signed as the signer GSA).
  Server-generated models persist in the uploaded-models dir (`$OFFICEXR_STUDIO_DATA_DIR/models`, else the gitignored
  `packages/world/uploaded-models`), created at startup and R2-synced under `models/`; `/models` serves it before the bundled models.
  With `OFFICEXR_STUDIO_API_JWT_SECRET` + `STUDIO_APP_URL` set, the studio MCP also registers `request_api_token {purpose}` (returns `{requestId, approvalUrl, expiresAt}`; the same user approves it at `approvalUrl` within 10 minutes) and `get_api_token {requestId}` (poll; once approved the token is returned exactly once and must be collected within 60 seconds by the requesting OAuth client). The token is a 60-minute JWT sent as `Authorization: Bearer <token>` to `<apiBaseUrl>/api/*` on the public port, acting as the approving login. Both tools need the OAuth `authInfo`, so they refuse on the internal `:5174/mcp`.
  `pnpm --filter @officexr/studio dev` keeps running the same storage, MCP and hooks inside Vite, including `/models` from the uploaded dir.
  The model-source upload tools (`request_model_upload`, `finalize_model`, `list_model_sources`; `model-sources/service.ts`) are wired only by
  studio-server's `main.ts` when the store is configured; the Vite dev studio doesn't register them.
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
- **Voice.** Proximity voice uses JaaS (Jitsi as a Service) rooms. The server mints each
  signed-in user's JaaS JWT at `GET /api/offices/:id/voice-token` (`jaasToken.ts`, claims from
  the session, never the request) with the server-only `OFFICEXR_JAAS_PRIVATE_KEY` /
  `OFFICEXR_JAAS_API_KEY_ID`; `/config.js` serves only the public `VITE_JAAS_APP_ID`. Never add
  a JaaS secret to `RUNTIME_CONFIG_KEYS`.
- **Missions.** A mission is a typed to-do in one office, stored in `office_missions`
  (migration `026_office_missions.sql`; RLS on with no policies, so only the server's
  database connection reads it). The contract is `packages/sdk/src/missions/types.ts`. Routes
  live in `packages/server/src/missions.ts` (`GET`/`POST /api/offices/:id/missions`,
  `PATCH`/`DELETE .../missions/:missionId`), storage behind `MissionsStore`
  (`missionsStore.ts` in memory, `missionsDb.ts` Postgres). The list is the caller's own plus
  shared missions, open first and newest first. Only the owner edits or deletes; anyone in the
  office may set `done` on a shared mission (else 403). Limits: title 140 characters, 20 steps,
  200 open missions per owner per office (409). After each write the server sends the custom
  frame `missions:changed` `{ officeId }` through `RealtimeServer.notifyOffice` (shared
  missions) or `notifyLogin` (private ones); clients re-read the list over HTTP and old
  clients ignore the frame. The opt-in Postgres spec is `missionsDb.test.ts` (`DB_URL`).

---

## Commands

```bash
pnpm dev          # Start web dev server (Vite, http://localhost:5173) with the backend in-process
pnpm build        # Build the web SPA (outputs to packages/web/dist/)
pnpm preview      # Preview the SPA build (static only: no API)
pnpm --filter @officexr/web dev:hud-preview   # HUD preview with no backend: http://localhost:5176/hud-preview?scenario=crowd
pnpm --filter @officexr/server start   # Production backend on :4173, admin on :8787
pnpm --filter @officexr/studio-server start   # Studio backend: internal :5174, public :5175
pnpm typecheck    # Typecheck every package
pnpm test         # Unit tests for every package
pnpm test:e2e:ci  # Hermetic Playwright suite run in CI
pnpm --filter @officexr/realtime-server start   # Realtime server on :8787
```

### Connect Claude to the studio MCP

Add a custom connector with URL `https://officexr-studio-api.karibalabs.co/mcp` and sign in as an
`admin_allowlist` login when prompted.

---

## Environment Variables

### Web backend (`packages/server/.env.example`)

Identity comes from Google sign-in: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`SESSION_SECRET` (signs the session cookie) and `PUBLIC_URL` (the external origin, no
trailing slash; the Google OAuth redirect URI is `${PUBLIC_URL}/auth/google/callback`).
`pnpm --filter @officexr/server start` refuses to boot unless all four are set. When `PUBLIC_URL` is
https the session cookie is Secure, so the TLS terminator must send
`X-Forwarded-Proto: https`. `FRONTEND_ORIGINS` (comma-separated exact origins or one-label https wildcards like `https://*.officexr.pages.dev`, matched by `isAllowedOrigin`; the first must be exact; unset = same-origin only; a sign-in returning to one outside the cookie's scope gets a 10-minute preview JWT in the `#officexr_token=` fragment, see `previewToken.ts`, which the web SPA and the studio send as `Authorization: Bearer`; the browser half is `@officexr/server/preview-token`)
allowlists SPAs on other origins for credentialed CORS and as `?next=` return targets (the first is the
default landing and the `login_error` target); they must be same-site with `PUBLIC_URL` because the cookie
is `SameSite=Lax`. `COOKIE_DOMAIN` (e.g. `karibalabs.co`, must contain `PUBLIC_URL`'s host) shares the
session cookie across subdomains; enabling it signs existing users out once, and the server clears the old host-only cookie on the next sign-in/out. Optional integrations, each off until its env is set and both mounted only with Google sign-in configured: `CALENDAR_ENCRYPTION_SECRET` (min 16 characters; AES-256-GCM key for the Google Calendar refresh tokens in `calendar_links`; adds `GET /auth/google/calendar[/callback]`, `GET /api/integrations`, `DELETE /api/calendar`, and `calendar` on each desk claimant; the Google client needs the redirect URI `${PUBLIC_URL}/auth/google/calendar/callback` and the `calendar.freebusy` scope) and `SLACK_BOT_TOKEN` plus `SLACK_SIGNING_SECRET` (both server-only; adds `POST /api/offices/:id/slack-ping` and the signed `POST /api/slack/interactions`; see `docs/slack/`). Code: `integrations.ts`, `calendarService.ts`, `googleCalendar.ts`, `slack.ts`. `createCors` and
`createSessionReader` are exported for the studio backend, which gates its public port with them. Who may sign in is managed with SQL in `login_allowlist`
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
server without the secret. The web backend needs the same secret (see `packages/server/.env.example`);
it mints the join tokens at `GET /api/realtime-token`. A standalone realtime server sets
`OFFICEXR_API_URL` (the web backend's origin, e.g. `http://host:4173`) to read office data over its
API, signing a short-lived `api`-audience bearer token with that secret (join tokens are not accepted
by the API, nor `api` tokens by the realtime server); unset, no session ever counts as multi-session.

---

## Studio Editors (5 modes)

The studio (`@officexr/studio`) at `pnpm --filter @officexr/studio dev` is
restructured into five purpose-built modes, each a separate App under
`packages/studio/src/modes/<name>/`:

| Mode      | Hash      | Purpose                                                  |
|-----------|-----------|----------------------------------------------------------|
| Map       | `#map`    | Compose Rooms into a world — placement, rotation, spawn points, environment (sun/sky/stars/HDRI) |
| Room      | `#room`   | Author a single Room: Select / Add / Delete / Tile tools, multi-select + groups, point-and-click cube placement |
| Object    | `#object` | Tune every cube kind: label, swatch, walkable, scale, tint, opacity, roughness, metalness, emissive; "Upload models" panel uploads model packs and finalizes them into kinds |
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

### Swimming, rides and pokes

Three kinds of placed objects and one key add movement to the office scene (`packages/world/src/motion/`, headless
and unit-tested; the renderer only plays it):

- **Pool** (`water: { surfaceHeight, rim }` on a kind, e.g. `prop_pool`): a player inside the footprint minus the rim
  swims (`pose: 'swim'`). Shift swims faster; Space does nothing in water. Walk over the rim to get in or out.
- **Rides** (`ride: { vehicle }` on a kind, e.g. `prop_scooter_rack`, `prop_tricycle_rack`): the object is a rack. F next to
  it mounts the vehicle (`pose: 'scooter' | 'tricycle'`), F again dismounts. The rack stays where it is.
- **Poke** (Q): reaches whoever stands in front of you within arm range; they flinch, turn toward you and see a toast.
- The pose travels as `presence:pose` and the poke as `poke:send` (SDK `protocol.ts`); peers derive the swim stroke, the
  lean and the buoyancy from the pose and the broadcast velocity.
- `prop_*` kinds and models come from `packages/world/scripts/generate-prop-models.ts`; the `pool_party` map shows all three.
  The default catalog fallback stays at the original 12 blocks, so these kinds exist only in `world-object-kinds.json`.

### Build mode, the wand and sound effects

- **Build** (B, or the Build button): any signed-in user places `prop_pool`, `prop_scooter_rack`, `prop_tricycle_rack` and
  `prop_wand_stand` (`PLACEABLE_KINDS` in `@officexr/sdk`). The ghost is 3 m ahead of the player on a 0.5-voxel grid;
  Enter or click places, R turns the ghost, Tab picks the next prop, T turns and G picks up the prop you point at, Delete
  removes it. Ops travel as `prop:op` custom frames to the realtime server, which calls `POST /api/offices/:id/props`
  (`packages/server`, table `office_props`, migration 024, at most 50 per office), then broadcasts the full list as the
  server-authority `office:props` event; late joiners get it in the snapshot. Placed props are merged into
  `useStoreWorldObjects`, so water, rides and colliders treat them like map instances.
- **Wand** (`prop_wand_stand`, `holdable` on the kind): F next to a stand picks the wand up (`presence:held`, the stand draws
  as its `emptyKindId`), F again puts it back. Q or a click casts, 1-4 pick the spell. `spell:cast` carries origin, direction,
  flight distance and the hit target; the caster resolves the hit, the realtime server only checks the schema, the sender,
  the held wand and the 1 s cooldown (`SpellCastGuard`) and replays running effects to joiners as `spell:effect`.
- **Spells** are a strategy table in `packages/sdk/src/spells/` (one file per spell plus one registry line); the hotkey order is
  the registry order and the first spell is the default.
- **Sound effects** are synthesised with Web Audio (`packages/world/src/audio/`): `cues.ts` decides which event plays which
  sound and its distance gain (tested), `synth.ts` and `engine.ts` make the sound. Silent until the first click or key;
  Settings > Controls holds the on/off switch and volume. The studio provides no engine, so it stays silent.

### 2D view

The web client's 2D view is the 3D view (`PlayView3d`) with the fixed follow camera locked
overhead (`OVERHEAD_CAMERA`, passed to `PlayView` as `fixedCamera`): same scene, models,
physics and seating, no separate renderer.

### Web HUD theme

The web HUD, settings and pages share one light liquid-glass theme: the `@theme` tokens and the
`hud-glass` / `hud-glass-thick` utilities in `packages/web/src/index.css`, the system font stack
(SF Pro on Apple devices), and the kit in `packages/web/src/hud/ui/` (`Panel` with a `material`,
`Button`, `IconButton`, `Tabs` with `segment` / `sidebar` variants, `Switch`, `Keycap`). Restyle
through the tokens and the kit rather than per component. A dark appearance (macOS-style)
redefines the same tokens under `:root[data-theme="dark"]`; `theme/appearance.ts` sets
`data-theme` from Settings → Appearance (Light / Dark / Auto, stored in localStorage, Auto follows
the system) and is initialised in `main.tsx` before the first paint. Use tokens, never raw
`white`/hex, so both appearances stay correct; the world's loading screen reads the same CSS
variables with light fallbacks.

### Hermetic HUD preview (`/hud-preview`)

Like the studio's `?test=1`, the web app has one startup branch for tests: `main.tsx` renders
`src/hud-preview/HudPreview` instead of `App` when `import.meta.env.DEV` is true and the path is
`/hud-preview`. A production build drops the branch and the module. The preview renders the real
`OfficeWorld` (HUD over the real `Scene`) with a fake identity and office, joined to an
in-memory channel (`createInMemoryChannelHub` through `createStack({ mode: 'local' })`) and a store
seeded from `?scenario=<name>`: `crowd`, `alone`, `wand`, `build`, `focus`, `full`
(`hud-preview/scenarios.ts`). `OfficeWorld` takes this through its optional `hermetic` prop, which
skips the join check and the realtime join; nothing else differs from production.

`pnpm --filter @officexr/web dev:hud-preview` serves it on :5176 with no database, sign-in or
realtime server (`vite.hud-preview.config.ts`: the checked-in studio maps, rooms and models, the
default map's layout baked first). Ladle stories (`pnpm --filter @officexr/web stories`, `src/hud/hud.stories.tsx`)
render each HUD component over the same seeded scenarios; Ladle's theme toggle switches light and dark.
Specs: `tests/playwright/hud-layout.spec.ts` asserts no HUD overlaps, nothing outside the viewport and
safe area, and touch targets of 44 px or more, for every scenario on phone, tablet and desktop
viewports. It is not in `test:e2e:ci` yet: the current layout fails it (see `docs/hud-review/README.md`),
so add it to the list once the layout is fixed. `hud-capture.spec.ts` writes screenshots when
`HUD_CAPTURE_DIR` is set.

`HudLayout`, the touch pad and the joystick keep off the screen edge through the `--hud-inset-*` tokens in
`index.css` (edge gap or safe area, whichever is larger). The specs set `--hud-safe-*` to a real device's
insets, since Chromium emulation reports zero for `env()`.

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

A fourth pack, `holiday` (27 Christmas objects), is a CC0 subset of Kenney's
[Holiday Kit 2.0](https://kenney.nl/assets/holiday-kit) (License.txt: "Creative
Commons Zero, CC0"). The installer pulls the converted zip
`Kenney_Holiday_Kit_2.0_gltf.zip` from R2; Kenney's own download links are signed and
short-lived, so the Dockerfile and the R2 copy pin the converted zip, not Kenney's.
If the R2 copy is missing the installer builds the pack straight from kenney.nl.
`pnpm --filter @officexr/world asset-packs:holiday-zip <out.zip>` rebuilds that zip
(deterministic; it prints the sha256 the Dockerfile pins). The conversion turns each
GLB into `.gltf` + `.bin` and bakes a 1.5x scale into a root node, because catalog
`scale` must stay 1. The build-mode palette lists six of them (`PLACEABLE_KINDS`).

## Database Migrations

SQL migrations live in `supabase/migrations/`. Apply them to `SUPABASE_DB_URL` with:

```bash
pnpm db:migrate           # supabase db push against SUPABASE_DB_URL
```

The container does not run migrations: its command only starts the server. Run `pnpm db:migrate`
as a pre-deploy job, before the rollout.

### Health, readiness and version

The image gets `OFFICEXR_COMMIT` (the build's `GIT_SHA`) and `OFFICEXR_BUILT_AT` from
`.github/workflows/image.yml`; without them the server uses `git rev-parse HEAD`, else `dev`.
`RealtimeServer` takes these through its `deployment` option; the web backend supplies the
database check (`packages/server/src/deployment.ts`), so `@officexr/realtime-server` knows no `pg`.

- `GET /health` (liveness): `{ok, commit, offices}`. Never touches the database.
- `GET /ready` (readiness): 200 `{status:"pass"}`, or 503 `{status:"fail", reason}` with `reason`
  `db-unreachable` or `schema-behind`. The check is cached for 60 s and times out after 1 s.
- `GET /version`: `{commit, builtAt, db:{expected, applied, ok}}`. `expected` is the highest
  `supabase/migrations/NNN_*.sql` in the image; `applied` is the highest `version` in
  `supabase_migrations.schema_migrations` (`null` when unreachable or empty).
- studio-server proxies `/health` and `/version` to the realtime process, which reports the commit only.

Point the cluster's liveness probe at `/health` and its readiness probe at `/ready`.
To check a deploy, `curl <host>/version` and compare `commit` with the merged SHA and
`db.applied` with `db.expected`.
