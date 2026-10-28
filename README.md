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
│   ├── web/              # @officexr/web — office app (React shell + /api server plugin)
│   ├── world/            # @officexr/world — renderer, physics, bots, maps/rooms
│   ├── studio/           # @officexr/studio — authoring editors
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

Copy and fill in `packages/web/.env.example`:

```bash
cp packages/web/.env.example packages/web/.env
```

```env
SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
OFFICEXR_DEV_USER_LOGIN=you@example.com   # `vite dev` only; signs every request in as this user
OFFICEXR_DEV_USER_NAME=You                # `vite dev` only
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
`pnpm --filter @officexr/web start`.

### Run

```bash
pnpm --filter @officexr/realtime-server start   # realtime server on :8787
pnpm dev                                        # web dev server at http://localhost:5173
```

The web server proxies `/ws` to the realtime server (`REALTIME_SERVER_TARGET`,
default `http://127.0.0.1:8787`).

## Building

```bash
pnpm build                  # outputs to packages/web/dist/
```

## License

MIT
