-- Only the web server's direct database connection reads or writes these; no policies keeps them off the public API.
create table if not exists public.user_blocks (
  blocker_login text        not null check (char_length(blocker_login) between 1 and 200),
  blocked_login text        not null check (char_length(blocked_login) between 1 and 200),
  blocked_name  text        check (blocked_name is null or char_length(blocked_name) <= 100),
  created_at    timestamptz not null default now(),
  primary key (blocker_login, blocked_login),
  check (blocker_login <> blocked_login)
);

alter table public.user_blocks enable row level security;

create table if not exists public.user_reports (
  id             uuid        primary key default gen_random_uuid(),
  office_id      uuid        references public.offices(id) on delete set null,
  reporter_login text        not null check (char_length(reporter_login) between 1 and 200),
  reported_login text        not null check (char_length(reported_login) between 1 and 200),
  reason         text        not null check (reason in ('harassment', 'spam', 'inappropriate', 'impersonation', 'other')),
  note           text        check (note is null or char_length(note) <= 500),
  created_at     timestamptz not null default now(),
  resolved_at    timestamptz
);

create index if not exists user_reports_open_idx on public.user_reports (created_at) where resolved_at is null;

alter table public.user_reports enable row level security;
