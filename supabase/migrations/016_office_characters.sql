-- Each user's chosen world character per office, keyed by Tailscale login.
create table if not exists public.office_characters (
  office_id    uuid        references public.offices(id) on delete cascade,
  user_login   text,
  character_id text        not null,
  updated_at   timestamptz default now(),
  primary key (office_id, user_login)
);

-- Only the web server's direct database connection reads or writes this; no policies keeps it off the public API.
alter table public.office_characters enable row level security;
