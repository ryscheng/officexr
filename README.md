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
  unauthenticated; keep it inside the cluster.
- `PUBLIC_PORT` (default 5175) serves `/api/*` and `/models/*`, and proxies `/health` and the
  `/ws` WebSocket to `REALTIME_SERVER_TARGET` (default `http://127.0.0.1:8787`). It is
  **unauthenticated until the studio auth gate lands — do not expose it**.

## Building

```bash
pnpm build                  # outputs the SPA to packages/web/dist/
```

## License

MIT
