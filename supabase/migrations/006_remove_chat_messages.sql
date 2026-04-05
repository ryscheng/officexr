-- Remove chat_messages table (chat is now ephemeral via Supabase Realtime broadcast only)
drop policy if exists "Chat messages are publicly readable" on public.chat_messages;
drop policy if exists "Authenticated users can insert chat messages" on public.chat_messages;
drop policy if exists "Anonymous users can insert chat messages" on public.chat_messages;
drop table if exists public.chat_messages;
