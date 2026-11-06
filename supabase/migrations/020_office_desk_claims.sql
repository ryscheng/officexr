-- Which login has claimed which desk (a map desk area id) in an office.
create table if not exists public.office_desk_claims (
  office_id  uuid        references public.offices(id) on delete cascade,
  desk_id    text        not null,
  user_login text        not null,
  claimed_at timestamptz default now(),
  primary key (office_id, desk_id),
  unique (office_id, user_login)
);

-- Only the web server's direct database connection reads or writes this; no policies keeps it off the public API.
alter table public.office_desk_claims enable row level security;
