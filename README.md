# OfficeXR

A 3D virtual office with real-time presence, proximity voice chat, and per-office characters. Offices are rendered in the browser from maps authored in the studio.

## Features

- **Google sign-in** — users sign in with Google; sessions live in Postgres and only emails or domains in the `login_allowlist` table may sign in
- **Real-time presence** — players see each other move via a WebSocket realtime server (`@officexr/realtime-server`)
- **World renderer** — offices render the studio map through `@officexr/world` (react-three-fiber + Rapier physics)
- **Characters** — each user picks a world character per office; the choice is stored server-side
- **Office chat** — text chat synced over the realtime channel
- **Proximity voice chat** — Jitsi as a Service (JaaS) rooms that form when players are near each other
- **Studio** — map, room, object, character and debug editors (`@officexr/studio`)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Web framework | Vite + React 19 |
| 3D rendering | Three.js via react-three-fiber, Rapier physics |
| Realtime | WebSocket server (`ws`) |
| Database | Postgres (schema in `supabase/migrations`), read server-side via `pg` |
| Identity | Google sign-in, Postgres-backed sessions |
| Voice chat | Jitsi as a Service (JaaS) |
| Package manager | pnpm workspaces |

## Project Structure

```
officexr/
├── packages/
│   ├── web/              # @officexr/web — office app (React SPA)
│   ├── server/           # @officexr/server — web backend: /api, Google sign-in, realtime
│   ├── world/            # @officexr/world — renderer, physics, bots, maps/rooms
│   ├── studio/           # @officexr/studio — authoring editors
│   ├── studio-server/    # @officexr/studio-server — studio backend: /api, /models, /mcp, SPA
│   ├── sdk/              # @officexr/sdk — headless game state + realtime protocol
│   ├── core-refactor/    # @officexr/core-refactor — stack factory, office session, voice
│   └── realtime-server/  # @officexr/realtime-server — WebSocket relay + WsChannel
├── supabase/migrations/  # SQL migrations (applied with `pnpm db:migrate`)
├── tests/playwright/     # Playwright e2e specs
├── pnpm-workspace.yaml
└── package.json          # Root scripts
```

## Getting Started

### Prerequisites

- Node.js 22+
- pnpm (`npm install -g pnpm`)
- A Postgres database (e.g. a Supabase project or `supabase start` locally)
- A [JaaS](https://jaas.8x8.vc) account (for proximity voice chat)

### Installation

```bash
pnpm install
```

### Environment Variables

Copy and fill in `packages/server/.env.example`. `pnpm dev` reads it from `packages/web/.env`;
`pnpm --filter @officexr/server start` reads only the process environment:

```bash
cp packages/server/.env.example packages/web/.env
```

```env
SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
OFFICEXR_DEV_USER_LOGIN=you@example.com   # `pnpm dev` only; signs every request in as this user
OFFICEXR_DEV_USER_NAME=You                # `pnpm dev` only
# Production sign-in (`start` refuses to boot without all four):
# GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
# GOOGLE_CLIENT_SECRET=your-client-secret
# SESSION_SECRET=a-long-random-string     # signs the session cookie
# PUBLIC_URL=https://officexr.example.com # redirect URI: ${PUBLIC_URL}/auth/google/callback
# FRONTEND_ORIGINS=https://app.example.com # optional; see "Sign-in"
# COOKIE_DOMAIN=example.com                # optional; see "Sign-in"
VITE_JAAS_APP_ID=your-jaas-app-id
VITE_JAAS_API_KEY_ID=your-jaas-api-key-id
VITE_JAAS_PRIVATE_KEY=your-jaas-private-key-base64
```

### Sign-in

Production signs users in with Google (create a Web application OAuth client and add
`${PUBLIC_URL}/auth/google/callback` as an authorized redirect URI). Only emails or
domains in the `login_allowlist` table may sign in; manage it with SQL (values lowercase).
When `PUBLIC_URL` is https the session cookie is Secure, so the TLS terminator in front of
the server must send `X-Forwarded-Proto: https`, or login loops back to Google:

```sql
insert into login_allowlist (kind, value) values ('domain', 'example.com');
insert into login_allowlist (kind, value) values ('email', 'someone@gmail.com');
```

To serve the SPAs from other origins, set `FRONTEND_ORIGINS` to their comma-separated exact origins
(`https://app.example.com`, no path). They may then call the API with credentials and pass an absolute
`?next=` on one of them to `/auth/google`; the first origin is the default landing page and where
`login_error` redirects go. Unset means same-origin only. The frontends must be same-site with
`PUBLIC_URL` (same registrable domain), because the session cookie is `SameSite=Lax`. Set `COOKIE_DOMAIN`
(e.g. `example.com`, a domain `PUBLIC_URL`'s host is on or under) to share the cookie across subdomains.
Turning it on signs existing users out once; the server clears the old host-only cookie on the next sign-in or sign-out.

For local development the `OFFICEXR_DEV_USER_*` variables skip Google entirely.

### Database

The web server reads Postgres directly; the browser makes no database calls.
The web server runs migrations with `pnpm db:migrate` (reads `SUPABASE_DB_URL` from the shell environment, not `packages/web/.env`); run it before
`pnpm --filter @officexr/server start`.

### Run

```bash
pnpm dev   # web dev server at http://localhost:5173, with the API and realtime in-process
```

`pnpm dev` mounts the backend (`@officexr/server`) and its own realtime office in the
Vite dev server, so it no longer shares an office with `pnpm bots:start` or the studio.

In production the backend is one process, `pnpm --filter @officexr/server start`:

- `PORT` (default 4173) serves `/api/*`, `/auth/*`, `/config.js`, `/models/*`, the realtime
  `/health` and `/rooms/:id/sessions`, and the `/ws` WebSocket. It serves no SPA (`GET /`
  is a 404); host `packages/web/dist` separately.
- `ADMIN_PORT` (default 8787) serves only `PUT /admin/world-constants`, guarded by
  `OFFICEXR_REALTIME_ADMIN_TOKEN`; keep it off the public network. The default clashes with a
  locally running realtime CLI or `pnpm bots:start`, so set `ADMIN_PORT` to run both.
- It refuses to boot without valid Google sign-in config.

The studio backend is a separate process, `pnpm --filter @officexr/studio-server start`
(after `pnpm --filter @officexr/studio build`):

- `PORT` (default 5174) serves the studio SPA, read/write `/api/*`, `/models/*` and `/mcp`,
  and proxies `/health` and `/ws` like `PUBLIC_PORT`. It is unauthenticated; keep it inside the
  cluster.
- `PUBLIC_PORT` (default 5175) serves `/api/*` and `/models/*`, and proxies `/health` and the
  `/ws` WebSocket to `REALTIME_SERVER_TARGET` (default `http://127.0.0.1:8787`). Every request and
  `/ws` upgrade needs the web backend's sign-in session for a login on `studio_allowlist`
  (401 without a session, 403 when not allowed); `GET /api/me` returns `{ login, name }`.
  It reads the session with the web backend's `SESSION_SECRET`, `SUPABASE_DB_URL` and `COOKIE_DOMAIN`,
  which must match it, and refuses to start without the first two. `FRONTEND_ORIGINS` allowlists the
  studio SPA's origin for credentialed CORS; its first origin sets whether the cookie is Secure and must be
  on or under `COOKIE_DOMAIN`. A studio user must be on both `login_allowlist` (to sign in) and
  `studio_allowlist` (lookups are cached for 60 s):

  ```sql
  insert into studio_allowlist (kind, value) values ('email', 'someone@example.com');
  ```

## Building

```bash
pnpm build                  # outputs the SPA to packages/web/dist/
```

### Cloudflare Pages

Host the SPA on Pages with the backend on another origin. Git-integration settings:

- Build command `pnpm --filter @officexr/web build`, output directory `packages/web/dist`.
- Environment variables `NODE_VERSION=22`, `PNPM_VERSION=10.33.0` and `VITE_API_ORIGIN=https://api.example.com`
  (the backend's origin; unset means same-origin). See `packages/web/.env.example`.

The backend must allow the Pages origin as a frontend origin (CORS and sign-in `next`) and set
`OFFICEXR_ASSET_BASE_URL`, since it doesn't serve `/baked-layouts/*` itself.

## License

MIT
