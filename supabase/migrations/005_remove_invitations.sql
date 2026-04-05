-- Remove invitations table and all related RLS policies
drop policy if exists "Users can view invitations for their email" on public.invitations;
drop policy if exists "Office owners/admins can create invitations" on public.invitations;
drop policy if exists "Users can update their own invitations" on public.invitations;
drop table if exists public.invitations;
