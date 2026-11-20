-- Keyed by login, not office: one link serves every office.
-- Only the web server's direct database connection reads or writes this; no policies keeps it off the public API.
create table if not exists public.calendar_links (
  login             text        primary key,
  refresh_token_enc text        not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.calendar_links enable row level security;
