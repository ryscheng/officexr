-- Bump per-tenant realtime quotas on the local-dev Supabase instance.
--
-- The seeded `realtime-dev` tenant ships with conservative defaults
-- (max_events_per_second = 100) that the multi-bot test harness blows
-- past as soon as you spawn >1 bot at 30 Hz. Those limits make sense
-- for hosted Supabase; for our local debug environment they just cause
-- server-side channel closures + REST broadcast fallback + 429 storms.
--
-- Run automatically after `pnpm supabase:test:start`. Idempotent —
-- safe to run on every restart.

UPDATE _realtime.tenants
SET
  max_events_per_second = 1000000,
  max_channels_per_client = 1000,
  max_concurrent_users = 5000,
  max_joins_per_second = 5000,
  max_bytes_per_second = 100000000,
  presence_enabled = true,
  broadcast_adapter = 'gen_rpc'
WHERE external_id = 'realtime-dev';
