-- Remove the invitations table; cascade takes its RLS policies with it.
-- A drop policy on a missing table errors on some Postgres versions, so a fresh database can't run one.
drop table if exists public.invitations cascade;
