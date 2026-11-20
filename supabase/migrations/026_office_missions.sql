-- Only the web server's direct database connection reads or writes this; no policies keeps it off the public API.
create table if not exists public.office_missions (
  id           uuid        primary key default gen_random_uuid(),
  office_id    uuid        not null references public.offices(id) on delete cascade,
  owner_login  text        not null,
  source       text        not null default 'mine' check (source in ('mine', 'artio', 'linear', 'github', 'calendar', 'slack')),
  title        text        not null check (char_length(title) between 1 and 140),
  steps        jsonb       not null default '[]',
  place        jsonb,
  due_at       timestamptz,
  person_login text        check (person_login is null or char_length(person_login) between 1 and 200),
  shared       boolean     not null default false,
  done         boolean     not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists office_missions_owner_idx on public.office_missions (office_id, owner_login);
create index if not exists office_missions_shared_idx on public.office_missions (office_id) where shared;

alter table public.office_missions enable row level security;
