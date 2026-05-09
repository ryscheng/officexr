# Test Supabase instance

Standalone Supabase config used by `@officexr/sdk` integration tests
under `packages/sdk/src/__tests__/integration/**`.

This is **separate from** the production `supabase/` directory at the repo
root because:

- The integration tests don't need the production schema (they only
  exercise Realtime broadcast + presence).
- Some pre-existing migrations have ordering issues that prevent a clean
  fresh-DB apply, which would block the test boot.

## Behavior

Integration tests **auto-skip** when Supabase isn't reachable. Each test
file probes `${SUPABASE_URL}/auth/v1/health` once at import time and
short-circuits the whole `describe` block via `describe.skipIf` if the
probe fails. So running `pnpm test` without Supabase running is fine —
the suite reports those tests as skipped, not failed.

Run with Supabase up to actually exercise them:

```bash
# from repo root
pnpm supabase:test:start   # boots Supabase (db + auth + realtime + kong)
pnpm test                  # integration tests now run
pnpm supabase:test:stop
```

Override the target URL via `SUPABASE_URL` / `SUPABASE_ANON_KEY` env
vars if needed.

## Project id

`officexr-test` — distinct from production `officexr` so docker
containers can coexist if the production stack is also running.
