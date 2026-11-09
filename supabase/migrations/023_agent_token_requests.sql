-- Requests by MCP agents for a short-lived studio API token. A request stays pending until the same user approves
-- it in the studio; the agent then claims a JWT once. The JWT itself is never stored.
-- Only the studio backend's direct database connection reads this; no policies keeps it off the public API.
create table if not exists public.agent_token_requests (
  id         text        primary key,
  login      text        not null,
  client_id  text        not null,
  purpose    text        not null,
  status     text        not null default 'pending' check (status in ('pending', 'approved', 'denied', 'claimed')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  decided_at timestamptz,
  claimed_at timestamptz
);

create index if not exists agent_token_requests_login_status_idx on public.agent_token_requests (login, status);

alter table public.agent_token_requests enable row level security;
