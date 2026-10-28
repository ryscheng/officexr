-- Login sessions for the web server's express-session store (connect-pg-simple's own schema).
create table if not exists public.session (
  sid    varchar      not null collate "default" primary key,
  sess   json         not null,
  expire timestamp(6) not null
);
create index if not exists "IDX_session_expire" on public.session (expire);

-- Who may sign in with Google: an exact email, or every email at a domain. Values are lowercase.
-- There is no admin UI; add entries with SQL, e.g.:
--   insert into public.login_allowlist (kind, value) values ('domain', 'example.com');
--   insert into public.login_allowlist (kind, value) values ('email', 'someone@gmail.com');
create table if not exists public.login_allowlist (
  kind       text        not null check (kind in ('email', 'domain')),
  value      text        not null check (value = lower(value)),
  created_at timestamptz not null default now(),
  primary key (kind, value)
);

-- Only the web server's direct database connection reads or writes these; no policies keeps them off the public API.
alter table public.session enable row level security;
alter table public.login_allowlist enable row level security;
