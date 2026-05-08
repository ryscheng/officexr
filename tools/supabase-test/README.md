# Test Supabase instance

Standalone Supabase config used by `@officexr/sdk` live integration tests
under `packages/sdk/src/__tests__/integration-live/**`.

This is **separate from** the production `supabase/` directory at the repo
root because:

- The live tests don't need the production schema (they only exercise
  Realtime broadcast + presence).
- Some pre-existing migrations have ordering issues that prevent a clean
  fresh-DB apply, which would block the test boot.

## Local usage

```bash
# from repo root
pnpm supabase:test:start   # boots Supabase (db + auth + realtime + kong)
pnpm test:live             # runs the live integration suite
pnpm supabase:test:stop    # stops it
```

The default URL/anon-key the tests use match this config; override via
`SUPABASE_URL` / `SUPABASE_ANON_KEY` env vars if needed.

## Project id

`officexr-test` — distinct from production `officexr` so docker
containers can coexist if the production stack is also running.
