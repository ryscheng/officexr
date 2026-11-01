-- Who may use the studio's public port: an exact email, or every email at a domain. Values are lowercase.
-- A studio user must also be on login_allowlist to sign in at all. Add entries with SQL, e.g.:
--   insert into public.studio_allowlist (kind, value) values ('email', 'someone@example.com');
create table if not exists public.studio_allowlist (
  kind       text        not null check (kind in ('email', 'domain')),
  value      text        not null check (value = lower(value)),
  created_at timestamptz not null default now(),
  primary key (kind, value)
);

-- Only the studio backend's direct database connection reads this; no policies keeps it off the public API.
alter table public.studio_allowlist enable row level security;
