-- OfficeXR initial schema
-- Run this in your Supabase SQL editor or via supabase db push

-- Enable UUID extension (already enabled in Supabase by default)
-- create extension if not exists "uuid-ossp";

-- Profiles: extends auth.users with app-specific data
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  name text,
  email text,
  avatar_url text,
  avatar_body_color text not null default '#3498db',
  avatar_skin_color text not null default '#ffdbac',
  avatar_style text not null default 'default',
  avatar_accessories text[] not null default '{}',
  created_at timestamptz not null default now()
);

-- Offices
create table if not exists public.offices (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

-- Office members (junction table with role)
create table if not exists public.office_members (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  unique (office_id, user_id)
);

-- Invitations
create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices on delete cascade,
  inviter_id uuid not null references auth.users on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'member')),
  token text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- Chat messages (persistent history, up to 50 per office queried on join)
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  office_id text not null,
  user_id uuid references auth.users on delete set null,
  user_name text,
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_office_id_created_at_idx
  on public.chat_messages (office_id, created_at desc);

-- ============================================================
-- Auto-create profile on new user signup
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, email, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.email,
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- Row Level Security
-- ============================================================

alter table public.profiles enable row level security;
alter table public.offices enable row level security;
alter table public.office_members enable row level security;
alter table public.invitations enable row level security;
alter table public.chat_messages enable row level security;

-- Profiles: users can read any profile, only update their own
create policy "Profiles are viewable by authenticated users"
  on public.profiles for select
  to authenticated
  using (true);

create policy "Users can insert their own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id);

-- Offices: readable by members, insertable by authenticated users
create policy "Offices are viewable by members"
  on public.offices for select
  to authenticated
  using (
    exists (
      select 1 from public.office_members
      where office_members.office_id = offices.id
        and office_members.user_id = auth.uid()
    )
  );

create policy "Authenticated users can create offices"
  on public.offices for insert
  to authenticated
  with check (true);

create policy "Owners and admins can update offices"
  on public.offices for update
  to authenticated
  using (
    exists (
      select 1 from public.office_members
      where office_members.office_id = offices.id
        and office_members.user_id = auth.uid()
        and office_members.role in ('owner', 'admin')
    )
  );

create policy "Only owners can delete offices"
  on public.offices for delete
  to authenticated
  using (
    exists (
      select 1 from public.office_members
      where office_members.office_id = offices.id
        and office_members.user_id = auth.uid()
        and office_members.role = 'owner'
    )
  );

-- Office members: viewable by members of the same office
create policy "Office members are viewable by office members"
  on public.office_members for select
  to authenticated
  using (
    exists (
      select 1 from public.office_members as om
      where om.office_id = office_members.office_id
        and om.user_id = auth.uid()
    )
  );

create policy "Authenticated users can insert office memberships"
  on public.office_members for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Invitations: users can see invitations for their email
create policy "Users can view invitations for their email"
  on public.invitations for select
  to authenticated
  using (email = auth.email());

create policy "Office owners/admins can create invitations"
  on public.invitations for insert
  to authenticated
  with check (
    exists (
      select 1 from public.office_members
      where office_members.office_id = invitations.office_id
        and office_members.user_id = auth.uid()
        and office_members.role in ('owner', 'admin')
    )
  );

create policy "Users can update their own invitations"
  on public.invitations for update
  to authenticated
  using (email = auth.email());

-- Chat messages: readable by anyone (for global office too), insertable by authenticated users
create policy "Chat messages are publicly readable"
  on public.chat_messages for select
  using (true);

create policy "Authenticated users can insert chat messages"
  on public.chat_messages for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Anonymous users can insert chat messages"
  on public.chat_messages for insert
  to anon
  with check (user_id is null);
