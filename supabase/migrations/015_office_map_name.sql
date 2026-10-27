-- The studio map an office renders; null means the "default" map.
alter table public.offices add column if not exists map_name text;
