-- Null for offices created before creators were recorded; those can't be edited.
alter table public.offices add column if not exists created_by_login text;
-- Lets the creator join the office from several windows.
alter table public.offices add column if not exists debug_enabled boolean not null default false;
