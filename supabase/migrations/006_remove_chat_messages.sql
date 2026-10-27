-- Remove chat_messages (chat is now ephemeral via Supabase Realtime broadcast only); cascade takes its RLS policies with it.
drop table if exists public.chat_messages cascade;
