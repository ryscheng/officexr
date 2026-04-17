# Build Commands — officexr

## Test
- `cd /home/user/officexr/packages/core && pnpm test`
- Runs: `vitest run`
- Test framework: Vitest v4.1.3 with jsdom environment
- 231 tests across 10 test files (as of 2026-04-16)

## Test file locations
- `packages/core/src/__tests__/hooks/` — all hook and component tests
- `packages/core/src/__tests__/setup.ts` — global mocks (THREE, supabase, browser APIs)
- `packages/core/src/__tests__/helpers.ts` — shared test helpers
