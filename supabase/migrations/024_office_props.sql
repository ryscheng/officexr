-- Props players placed in an office (pool, racks, wand stand); position is in voxels like a map instance.
create table if not exists public.office_props (
  office_id  uuid        not null references public.offices(id) on delete cascade,
  id         text        not null,
  kind_id    text        not null check (kind_id in ('prop_pool', 'prop_scooter_rack', 'prop_tricycle_rack', 'prop_wand_stand')),
  x          real        not null,
  y          real        not null,
  z          real        not null,
  yaw_deg    smallint    not null default 0 check (yaw_deg in (0, 90, 180, 270)),
  placed_by  text,
  created_at timestamptz not null default now(),
  primary key (office_id, id)
);

-- Only the web server's direct database connection reads or writes this; no policies keeps it off the public API.
alter table public.office_props enable row level security;
