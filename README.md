# OfficeXR

A 3D virtual office with real-time presence, proximity voice chat, and per-office characters. Offices are rendered in the browser from maps authored in the studio.

## Features

- **Tailscale identity** — the app trusts the `Tailscale-User-Login` / `Tailscale-User-Name` headers added by Tailscale Serve; there is no in-app login
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
| Identity | Tailscale Serve headers |
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
OFFICEXR_DEV_USER_LOGIN=you@example.com   # dev server only; injected as Tailscale-User-Login
OFFICEXR_DEV_USER_NAME=You                # dev server only; injected as Tailscale-User-Name
VITE_JAAS_APP_ID=your-jaas-app-id
VITE_JAAS_API_KEY_ID=your-jaas-api-key-id
VITE_JAAS_PRIVATE_KEY=your-jaas-private-key-base64
```

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
