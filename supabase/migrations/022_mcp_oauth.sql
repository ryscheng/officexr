-- MCP OAuth authorization server state. Codes, tokens and client secrets are stored only as SHA-256 hashes.
-- Only the studio backend's direct database connection reads these; no policies keeps them off the public API.
create table if not exists public.mcp_oauth_clients (
  client_id   text        primary key,
  metadata    jsonb       not null,
  secret_hash text,
  created_at  timestamptz not null default now()
);

create table if not exists public.mcp_oauth_codes (
  code_hash      text        primary key,
  client_id      text        not null references public.mcp_oauth_clients (client_id) on delete cascade,
  login          text        not null,
  code_challenge text        not null,
  redirect_uri   text        not null,
  scopes         text[]      not null default '{}',
  resource       text,
  expires_at     timestamptz not null,
  consumed_at    timestamptz
);

create table if not exists public.mcp_oauth_tokens (
  token_hash text        primary key,
  kind       text        not null check (kind in ('access', 'refresh')),
  client_id  text        not null references public.mcp_oauth_clients (client_id) on delete cascade,
  login      text        not null,
  scopes     text[]      not null default '{}',
  resource   text,
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create index if not exists mcp_oauth_tokens_login_idx on public.mcp_oauth_tokens (login);

alter table public.mcp_oauth_clients enable row level security;
alter table public.mcp_oauth_codes enable row level security;
alter table public.mcp_oauth_tokens enable row level security;
